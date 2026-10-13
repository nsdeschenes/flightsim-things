import {defineConfig} from 'drizzle-kit';

const config = defineConfig({
  dialect: 'sqlite',
  out: './drizzle',
  schema: './src/database/tables/*.ts',
});

export default config;
