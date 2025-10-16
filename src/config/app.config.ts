import dotenv from 'dotenv';
dotenv.config({
  quiet: true,
});

const getEnvVar = (
  key: string,
  defaultValue: string | undefined = undefined
) => {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing ${key}. Please set it in the .env file.`);
  }

  return value;
};

export const PORT = parseInt(getEnvVar('PORT', '9000'), 10);
export const BASE_DOMAIN = getEnvVar('BASE_DOMAIN', 'localhost:9000');
export const HTTPS = getEnvVar('HTTPS', 'false') === 'true';
export const DEBUG = getEnvVar('DEBUG', 'false') === 'true';
export const TUNNEL_SERVER = getEnvVar('TUNNEL_SERVER', 'wss://tunl.cc');

export const DB_HOST = getEnvVar('DB_HOST', 'localhost');
export const DB_PORT = parseInt(getEnvVar('DB_PORT', '5432'), 10);
export const DB_NAME = getEnvVar('DB_NAME', 'tunlcc_dev');
export const DB_USER = getEnvVar('DB_USER', 'postgres');
export const DB_PASSWORD = getEnvVar('DB_PASSWORD', 'postgres');
export const DB_SSL = getEnvVar('DB_SSL', 'false') === 'true';
