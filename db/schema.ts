import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

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

export const videoUploads = sqliteTable('video_uploads', {
  memoryId: text('memory_id').primaryKey(),
  objectKey: text('object_key').notNull(),
  uploadId: text('upload_id').notNull(),
  metadata: text('metadata').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
}, table => [index('video_uploads_expiry_idx').on(table.expiresAt)]);

export const videoUploadParts = sqliteTable('video_upload_parts', {
  memoryId: text('memory_id').notNull(),
  partNumber: integer('part_number').notNull(),
  etag: text('etag').notNull(),
  byteSize: integer('byte_size').notNull(),
}, table => [primaryKey({columns:[table.memoryId, table.partNumber]})]);
