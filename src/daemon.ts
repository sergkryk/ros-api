import * as net from "net";
import * as fs from "fs";
import handleCommand from "./controller";
import { checkCredentials } from "./config-preloader";
import { getConnection } from "./ros-openai";

const SOCKET_PATH = "/tmp/mikrotik.sock";

// Удаляем старый сокет если существует
if (fs.existsSync(SOCKET_PATH)) {
  fs.unlinkSync(SOCKET_PATH);
}

// Проверяю загрузился ли конфиг для доступа к серверам
if (!checkCredentials()) {
  throw new Error("Данные доступа к серверам не загружены");
}

/**
 * Unix socket сервер для приема команд управления RouterOS устройствами
 * Принимает подключения на SOCKET_PATH, принимает команды
 * и отправляет их в handleCommand для обработки
 * Возвращает "OK" при успехе или "ERROR: <message>" при ошибке
 */
const server = net.createServer((client) => {
  client.on("data", (data) => {
    const command = data.toString().trim();

    handleCommand(command)
      .then(() => {
        client.write("OK\n");
      })
      .catch((err) => {
        client.write(`ERROR: ${err.message}\n`);
      })
      .finally(() => {
        client.end();
      });
  });

  client.on("error", (err) => {
    console.error("Client error:", err);
  });
});

server.listen(SOCKET_PATH, () => {
  console.log(`Server listening on ${SOCKET_PATH}`);
  fs.chmodSync(SOCKET_PATH, 0o666);
});

/**
 * Обработчик сигнала SIGINT (Ctrl+C) для корректного завершения работы сервера
 * - Закрывает socket сервер
 * - Удаляет файл Unix socket
 * - Завершает процесс с кодом 0 (успешное завершение)
 */
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close();
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
  process.exit(0);
});
