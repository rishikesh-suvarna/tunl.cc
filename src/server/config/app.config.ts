import dotenv from 'dotenv';
dotenv.config();

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
