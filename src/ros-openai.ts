// routeros.ts
// Полноценный RouterOS API клиент на TypeScript (Node.js) с детальными комментариями.
//
// Быстрый старт:
//   ts-node routeros.ts <host> [user=admin] [password=""] [secure=false] [port]
// Примеры:
//   ts-node routeros.ts 192.0.2.1 admin mypass
//   ts-node routeros.ts router.local admin "" true 8729
//
// Основные концепции RouterOS API:
// - Сообщения состоят из "слов" (word). Слово = префикс длины (1..5 байт, varint по правилу RouterOS) + данные UTF-8.
// - Набор слов, заканчивающийся пустым словом ("") — это "предложение" (sentence).
// - Клиент отправляет предложение, сервер отвечает одной или несколькими предложениями, завершаясь словом-типом "!done".
// - Авторизация поддерживает 2 формы: простой логин/пароль и challenge-response. Мы реализуем обе:
//   1) отправка /login с name+password; если сервер вернул '=ret', то нужен challenge-response
//   2) MD5(0x00 || password || challenge) и отправка /login с name + response=00<md5hex>
//
// Безопасность TLS:
// - RouterOS часто использует самоподписанные сертификаты, поэтому в примере rejectUnauthorized=false,
//   но в проде лучше включить валидацию и настроить доверенные CA.

import net from "net";
import tls from "tls";
import crypto from "crypto";
import * as readline from "readline";

/**
 * Кортеж одного предложения ответа API:
 * reply — тип ответа ('!re', '!trap', '!done' и т.д.),
 * attributes — словарь атрибутов из остальных слов предложения.
 */
export type ApiReply = [reply: string, attributes: Record<string, string>];

/**
 * SocketBuffer — легковесный буферизатор чтения поверх сокета.
 *cla
 * ЗАДАЧА:
 *  - накапливать входящие чанки
 *  - выдавать ровно N байт по запросу readExact(N)
 *  - корректно обрабатывать завершение соединения и ошибки
 *
 * ПОЧЕМУ НУЖНО:
 *  - протокол RouterOS использует varint длины, после чего нужно дочитать ровно length байт данных;
 *    Node.js даёт чанки произвольных границ, поэтому нужен слой, который умеет "дочитать" ровно столько, сколько надо.
 */
class SocketBuffer {
  private queue: Buffer[] = [];
  private totalLength = 0;
  private waiters: Array<{
    size: number;
    resolve: (b: Buffer) => void;
    reject: (e: any) => void;
  }> = [];
  private closed = false;
  private error: any = null;

  /**
   * Помещает очередной чанк во внутреннюю очередь и пытается обработать ожидающих читателей.
   */
  feed(chunk: Buffer) {
    if (this.closed || this.error) return;
    this.queue.push(chunk);
    this.totalLength += chunk.length;
    this.flush();
  }

  /**
   * Сигнализирует, что сокет завершил передачу (end/close).
   * Если есть ожидающие читатели — они получат ошибку при нехватке байт.
   */
  end() {
    this.closed = true;
    this.flush();
  }

  /**
   * Сигнализирует об ошибке сокета: все ожидающие читатели получают reject(err).
   */
  fail(err: any) {
    this.error = err;
    while (this.waiters.length) {
      const waiter = this.waiters.shift()!;
      waiter.reject(err);
    }
  }

  /**
   * Внутренний насос: проверяет, можно ли удовлетворить верхнего читателя,
   * а затем, если можно, копирует запрошенное количество байт из очереди.
   */
  private flush() {
    while (this.waiters.length) {
      const waiter = this.waiters[0];

      // Если ранее произошла ошибка — немедленно её отдать ожидающему.
      if (this.error) {
        this.waiters.shift()!.reject(this.error);
        continue;
      }

      // Недостаточно данных: ждать новые чанки. Если поток закрыт — это ошибка (недочитали).
      if (this.totalLength < waiter.size) {
        if (this.closed) {
          this.waiters.shift()!.reject(new Error("connection closed by remote end"));
        }
        break;
      }

      // Можно выдать данные: склеиваем из головы очереди.
      this.waiters.shift();
      const out = Buffer.allocUnsafe(waiter.size);
      let written = 0;
      while (written < waiter.size) {
        const head = this.queue[0];
        const take = Math.min(head.length, waiter.size - written);
        head.copy(out, written, 0, take);
        written += take;
        if (take === head.length) {
          this.queue.shift();
        } else {
          this.queue[0] = head.subarray(take);
        }
      }
      this.totalLength -= waiter.size;
      waiter.resolve(out);
    }
  }

  /**
   * Читает ровно size байт. Возвращает Promise, который зарезолвится, когда накопится достаточно данных.
   * Если соединение завершится раньше — ошибка.
   */
  readExact(size: number): Promise<Buffer> {
    if (size === 0) return Promise.resolve(Buffer.alloc(0));
    return new Promise<Buffer>((resolve, reject) => {
      this.waiters.push({ size, resolve, reject });
      this.flush();
    });
  }
}

/**
 * RouterOSClient — высокоуровневый клиент для общения с RouterOS API.
 * Содержит:
 *  - авторизацию (включая challenge-response)
 *  - генератор sendCommand для отправки команд и чтения ответов
 *  - низкоуровневые помощники: предложение/слово, кодирование/декодирование длины
 */
export class RouterOSClient {
  private socket: net.Socket | tls.TLSSocket;
  private buffer = new SocketBuffer();
  private verbose: boolean;

  /**
   * @param socket - уже установленное TCP/TLS соединение
   * @param verbose - если true, логирует отправляемые/получаемые слова вида "<<<" / ">>>"
   */
  constructor(socket: net.Socket | tls.TLSSocket, verbose = false) {
    this.socket = socket;
    this.verbose = verbose;

    // Привязываем обработчики сокета к буферизатору:
    socket.on("data", (chunk) => this.buffer.feed(chunk));
    socket.on("end", () => this.buffer.end());
    socket.on("close", () => this.buffer.end());
    socket.on("error", (err) => this.buffer.fail(err));
  }

  // ─────────────────────────── Высокоуровневое API ───────────────────────────

  /**
   * Логин в RouterOS.
   *
   * Алгоритм:
   *  1) Отправляем /login с name и password.
   *  2) Если ответ содержит '=ret', RouterOS требует challenge-response:
   *     - вычисляем MD5(0x00 || password || hex2bin(ret))
   *     - отправляем /login c name и response=00<md5hex>
   *  3) Если где-то приходит '!trap' — логин провален.
   *
   * Возвращает true при успехе, false при ошибке.
   */
  async login(username: string, password: string): Promise<boolean> {
    // Первичная попытка логина: либо сразу успех, либо сервер вернёт '=ret' для challenge.
    for await (const [reply, attributes] of this.sendCommand([
      "/login",
      `=name=${username}`,
      `=password=${password}`,
    ])) {
      if (reply === "!trap") return false;

      // Сервер запросил challenge-response:
      if ("=ret" in attributes) {
        const challengeHex = attributes["=ret"];
        const challenge = Buffer.from(challengeHex, "hex");

        // вычисление MD5(0x00 || password || challenge)
        const md5 = crypto.createHash("md5");
        md5.update(Buffer.from([0x00]));
        md5.update(Buffer.from(password, "utf8"));
        md5.update(challenge);
        const md5Digest = md5.digest("hex");

        // отправка ответа с префиксом '00'
        for await (const [reply2] of this.sendCommand([
          "/login",
          `=name=${username}`,
          `=response=00${md5Digest}`,
        ])) {
          if (reply2 === "!trap") return false;
        }
      }
    }
    return true;
  }

  /**
   * Отправляет команду (массив слов) и асинхронно итерирует по предложениям ответа.
   *
   * ПОЧЕМУ ГЕНЕРАТОР:
   *  - RouterOS может прислать несколько предложений (!re ...), затем финальное '!done'.
   *  - Генератор позволяет потребителю постепенно обрабатывать ответы по мере поступления.
   *
   * КАК ПАРСИМ:
   *  - Первое слово предложения — тип ('!re', '!trap', '!done').
   *  - Остальные слова вида '=key=value' раскладываем в attributes.
   */
  async *sendCommand(words: string[]): AsyncGenerator<ApiReply, void, unknown> {
    const sentCount = await this.sendSentence(words);
    if (sentCount === 0) return; // ничего не отправили — нет и ответов

    while (true) {
      const sentence = await this.receiveSentence();
      if (sentence.length === 0) continue; // пустые предложения игнорим (на практике не должно быть)

      const replyType = sentence[0];
      const attributes: Record<string, string> = {};

      // Слова вида '=key=value' превращаем в { '=key': 'value' } (как в Python-оригинале).
      for (const word of sentence.slice(1)) {
        const splitIndex = word.indexOf("=", 1); // ищем '=' начиная со второй позиции
        if (splitIndex === -1) {
          attributes[word] = "";
        } else {
          attributes[word.substring(0, splitIndex)] = word.substring(splitIndex + 1);
        }
      }

      yield [replyType, attributes];

      // Конец ответа на запрос — '!done'.
      if (replyType === "!done" || replyType === "!empty") return;
    }
  }

  /**
   * Закрывает соединение с RouterOS устройством
   * Отправляет FIN пакет и корректно завершает TCP/TLS соединение
   */
  async close() {
    this.socket.end();
  }

  // ─────────────────────── Помощники: предложения/слова ───────────────────────

  /**
   * Отправляет "предложение": все слова по очереди, затем пустое слово-терминатор.
   * Возвращает число отправленных непустых слов (для информации).
   */
  private async sendSentence(words: string[]): Promise<number> {
    let count = 0;
    for (const word of words) {
      await this.sendWord(word);
      count++;
    }
    await this.sendWord(""); // пустое слово завершает предложение
    return count;
  }

  /**
   * Читает одно "предложение" (массив слов) до пустого слова-терминатора.
   * Пустое слово не включается в результат.
   */
  private async receiveSentence(): Promise<string[]> {
    const sentence: string[] = [];
    while (true) {
      const word = await this.receiveWord();
      if (word === "") return sentence; // терминатор предложения
      sentence.push(word);
    }
  }

  /**
   * Отправляет одно "слово":
   *  1) кодирует его длину в формате RouterOS (1..5 байт)
   *  2) пишет байты строки UTF-8
   * При включённом verbose логирует "<<< слово".
   */
  private async sendWord(word: string): Promise<void> {
    if (this.verbose) console.log("<<< " + word);
    const data = Buffer.from(word, "utf8");
    const lengthBuffer = this.encodeLength(data.length);
    await this.write(lengthBuffer);
    await this.write(data);
  }

  /**
   * Получает одно "слово":
   *  1) читает varint-длину
   *  2) читает указанное количество байт
   *  3) декодирует в UTF-8 (при ошибке падаем на latin1 как "лучше чем бросить исключение")
   * При включённом verbose логирует ">>> слово".
   */
  private async receiveWord(): Promise<string> {
    const length = await this.decodeLength();
    const data = await this.buffer.readExact(length);

    let decoded: string;
    try {
      decoded = data.toString("utf8");
    } catch {
      decoded = data.toString("latin1");
    }

    if (this.verbose) console.log(">>> " + decoded);
    return decoded;
  }

  // ─────────────────────── Кодирование/декодирование длины ───────────────────────
  //
  // Формат длины RouterOS (из документации):
  //  - 0xxxxxxx: одна байта, значение 0..127
  //  - 10xxxxxx xxxxxxxx: две байты, 0..16383, к значению добавляют флаг 0x8000
  //  - 110xxxxx xxxxxxxx xxxxxxxx: три байты, +0xC00000
  //  - 1110xxxx xxxxxxxx xxxxxxxx xxxxxxxx: четыре байты, +0xE0000000
  //  - 11110xxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx: пять байт, первый 0xF0, затем 4 байта длины
  //
  // Ниже — точные реализации инкапсуляции/деинкапсуляции.

  /**
   * Кодирует целое length в префикс длины RouterOS (1..5 байт).
   */
  private encodeLength(length: number): Buffer {
    if (length < 0x80) {
      // 0xxxxxxx
      return Buffer.from([length]);
    } else if (length < 0x4000) {
      // 10xxxxxx xxxxxxxx
      length |= 0x8000;
      return Buffer.from([(length >> 8) & 0xff, length & 0xff]);
    } else if (length < 0x200000) {
      // 110xxxxx xxxxxxxx xxxxxxxx
      length |= 0xc00000;
      return Buffer.from([(length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
    } else if (length < 0x10000000) {
      // 1110xxxx xxxxxxxx xxxxxxxx xxxxxxxx
      length |= 0xe0000000;
      return Buffer.from([
        (length >> 24) & 0xff,
        (length >> 16) & 0xff,
        (length >> 8) & 0xff,
        length & 0xff,
      ]);
    } else {
      // 11110xxx + 4 байта значения
      return Buffer.from([
        0xf0,
        (length >> 24) & 0xff,
        (length >> 16) & 0xff,
        (length >> 8) & 0xff,
        length & 0xff,
      ]);
    }
  }

  /**
   * Декодирует префикс длины (1..5 байт) в целое число байт, требуемых для чтения слова.
   * Если формат некорректен — бросает ошибку.
   */
  private async decodeLength(): Promise<number> {
    const firstByte = (await this.buffer.readExact(1))[0];

    if ((firstByte & 0x80) === 0x00) {
      // 0xxxxxxx
      return firstByte;
    } else if ((firstByte & 0xc0) === 0x80) {
      // 10xxxxxx xxxxxxxx
      const b = await this.buffer.readExact(1);
      return ((firstByte & ~0xc0) << 8) + b[0];
    } else if ((firstByte & 0xe0) === 0xc0) {
      // 110xxxxx xxxxxxxx xxxxxxxx
      const b = await this.buffer.readExact(2);
      return ((firstByte & ~0xe0) << 16) + (b[0] << 8) + b[1];
    } else if ((firstByte & 0xf0) === 0xe0) {
      // 1110xxxx xxxxxxxx xxxxxxxx xxxxxxxx
      const b = await this.buffer.readExact(3);
      return ((firstByte & ~0xf0) << 24) + (b[0] << 16) + (b[1] << 8) + b[2];
    } else if ((firstByte & 0xf8) === 0xf0) {
      // 11110xxx xxxxxxxx xxxxxxxx xxxxxxxx xxxxxxxx
      const b = await this.buffer.readExact(4);
      return (b[0] << 24) + (b[1] << 16) + (b[2] << 8) + b[3];
    } else {
      throw new Error("invalid length prefix");
    }
  }

  /**
   * Низкоуровневая запись байтов в сокет c Promise-интерфейсом.
   * Гарантирует, что ошибка записи превратится в reject, а успех — в resolve.
   */
  private write(buffer: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(buffer, (err) => (err ? reject(err) : resolve()));
    });
  }
}

function getCredentials(nas: string) {}

/**
 * Устанавливает TCP или TLS соединение с RouterOS.
 *
 * @param host   адрес устройства RouterOS
 * @param port   порт (8728 для TCP, 8729 для TLS по умолчанию)
 * @param useTLS true — TLS, false — обычный TCP
 *
 * Замечания по безопасности:
 *  - В примере rejectUnauthorized=false, чтобы упростить подключение к устройствам с самоподписанными сертификатами.
 *    Для продакшена стоит настроить собственный CA и включить строгую проверку.
 */
function openSocket(
  host: string,
  port: number,
  useTLS: boolean,
): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    if (useTLS) {
      const socket = tls.connect(
        {
          host,
          port,
          rejectUnauthorized: false, // принять самоподписанный сертификат RouterOS
        },
        () => resolve(socket),
      );
      socket.on("error", reject);
    } else {
      const socket = net.createConnection({ host, port }, () => resolve(socket));
      socket.on("error", reject);
    }
  });
}

export async function getConnection(
  host: string,
  username: string,
  password: string,
  useTLS: boolean = false,
  port: number = useTLS ? 8729 : 8728,
): Promise<RouterOSClient> {
  // 1) Соединяемся
  const socket = await openSocket(host, port, useTLS);

  // 2) Создаём клиента с verbose-логированием слов (как в Python печатали "<<<"/">>>")
  const client = new RouterOSClient(socket, false);

  // 3) Логинимся
  const loginSuccess = await client.login(username, password);
  if (!loginSuccess) {
    socket.end();
    throw new Error("Failed to login");
  }
  return client;
}

/**
 * CLI-входная точка.
 *
 * Функции:
 *  - парсит аргументы командной строки: host, user, pass, secure, port
 *  - открывает соединение (TCP/TLS) и логинится
 *  - запускает 2 параллельных потока:
 *      1) приём предложений от RouterOS (и логирование)
 *      2) чтение строк из stdin: непустые строки добавляются к текущему предложению, пустая — отправка
 *
 * Схема ввода пользователя полностью повторяет поведение оригинального Python-скрипта.
 */
async function main() {
  const args = process.argv.slice(2);

  // Валидация: нужен хотя бы хост.
  if (args.length < 1) {
    console.error(
      'Usage: ts-node routeros.ts <host> [user=admin] [password=""] [secure=false] [port]',
    );
    process.exit(1);
  }

  const host = args[0];
  const username = args[1] ?? "admin";
  const password = args[2] ?? "";
  const useTLS = (args[3] ?? "false").toLowerCase() === "true";
  const port = args[4] ? parseInt(args[4], 10) : useTLS ? 8729 : 8728;

  // 1) Соединяемся
  const socket = await openSocket(host, port, useTLS);

  // 2) Создаём клиента с verbose-логированием слов (как в Python печатали "<<<"/">>>")
  const client = new RouterOSClient(socket, true);

  // 3) Логинимся
  const loginSuccess = await client.login(username, password);
  if (!loginSuccess) {
    console.error("Login failed");
    socket.end();
    process.exit(1);
  }

  // 4) Интерактивные циклы

  // Настраиваем readline: пустая строка = "отправить накопленное предложение".
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  let pendingCommand: string[] = [];

  // Фоновый приём предложений от RouterOS:
  // Получаем предложение целиком (receiveSentence), но подробный лог уже есть на уровне слов (verbose).
  (async () => {
    try {
      while (true) {
        const sentence = await (client as any).receiveSentence(); // намеренно используем внутренний метод ради компактности
        if (sentence.length) {
          // Дополнительная "сводка" по предложению:
          console.log("[sentence]", JSON.stringify(sentence));
        }
      }
    } catch {
      // Закрытие сокета или ошибка чтения — закрываем CLI
      rl.close();
    }
  })();

  // Обработка ввода пользователя:
  // Любая непустая строка добавляется как слово. Пустая строка — отправляем "предложение".
  rl.on("line", async (line) => {
    const trimmed = line.replace(/\r?\n$/, "");
    if (trimmed === "") {
      try {
        await (client as any).sendSentence(pendingCommand);
      } catch (e) {
        console.error("send failed:", e);
        rl.close();
      }
      pendingCommand = [];
    } else {
      pendingCommand.push(trimmed);
    }
  });

  // Корректное завершение: закрыть сокет.
  rl.on("close", () => {
    socket.end();
    process.exit(0);
  });
}

// Запуск main() при старте файла как скрипта.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
