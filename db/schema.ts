import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  memoryDate: text('memory_date').notNull(),
  body: text('body').notNull(),
  location: text('location').notNull(),
  objectKey: text('object_key'),
  mime: text('mime'),
  byteSize: integer('byte_size').notNull().default(0),
  filename: text('filename'),
  createdAt: text('created_at').notNull(),
}, table => [index('memories_date_idx').on(table.memoryDate)]);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const favorites = sqliteTable('favorites', {
  memoryId: text('memory_id').primaryKey(),
});
