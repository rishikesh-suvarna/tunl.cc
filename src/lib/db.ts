/* eslint-disable @typescript-eslint/no-require-imports */
import knex, { Knex } from 'knex';
import { NODE_ENV } from '../config/app.config';

const knexConfig = require('../../knexfile');

const environment = NODE_ENV || 'development';
const config = knexConfig[environment];

if (!config) {
  throw new Error(
    `Knex configuration for environment "${environment}" is not defined.`
  );
}

export const db: Knex = knex(config);

export async function testConnection(): Promise<boolean> {
  try {
    await db.raw('SELECT 1');
    console.log('Database connected successfully');
    return true;
  } catch (err) {
    console.error('Database connection failed:', err);
    return false;
  }
}
