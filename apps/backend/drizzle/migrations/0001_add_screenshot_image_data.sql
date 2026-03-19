ALTER TABLE "screenshots" ADD COLUMN IF NOT EXISTS "image_data" bytea;
ALTER TABLE "screenshots" ALTER COLUMN "storage_path" SET DEFAULT '';
