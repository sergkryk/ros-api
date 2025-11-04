import * as fs from "fs";
import * as path from "path";

const NAS_SERVERS = ["10.45.0.156", "10.45.0.153", "10.45.0.55"] as const;
export type NasServer = (typeof NAS_SERVERS)[number];

const CONFIG_FILE = "nas-config.json";
const configPath = path.join(__dirname, "..", CONFIG_FILE);

interface NasCredentialsConfig {
  user: string;
  password: string;
}

function isNasCredentialsConfig(candidate: unknown): candidate is NasCredentialsConfig {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "user" in candidate &&
    "password" in candidate
  );
}

/**
 * Определяю конфиг для доступа к серверам
 * CONFIG_FILE - файл с логинами и паролями к серверам NAS
 * должен лежать в корне с проектом
 */
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

export function checkCredentials() {
  return (
    typeof config === "object" &&
    config !== null &&
    "servers" in config &&
    typeof config["servers"] === "object" &&
    NAS_SERVERS.every((server) => {
      return server in config.servers && isNasCredentialsConfig(config.servers[server]);
    })
  );
}

export function getCredentials(nas: NasServer): NasCredentialsConfig {
  return config.servers[nas];
}
