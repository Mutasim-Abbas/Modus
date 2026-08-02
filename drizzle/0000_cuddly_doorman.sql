CREATE TYPE "public"."activity_level" AS ENUM('sedentary', 'light', 'moderate', 'very', 'extra');--> statement-breakpoint
CREATE TYPE "public"."auth_attempt_action" AS ENUM('login', 'signup', 'password_change', 'recovery_redeem');--> statement-breakpoint
CREATE TYPE "public"."auth_attempt_scope" AS ENUM('ip', 'account');--> statement-breakpoint
CREATE TYPE "public"."entry_source" AS ENUM('food-db', 'scan', 'manual');--> statement-breakpoint
CREATE TYPE "public"."food_category" AS ENUM('protein', 'grains', 'dairy', 'fruit', 'vegetables', 'fats & nuts', 'snacks', 'drinks', 'turkish & middle eastern');--> statement-breakpoint
CREATE TYPE "public"."goal" AS ENUM('cut', 'maintain', 'bulk');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('en', 'ar');--> statement-breakpoint
CREATE TYPE "public"."meal_slot" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TABLE "auth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"scope" "auth_attempt_scope" NOT NULL,
	"action" "auth_attempt_action" NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_attempts_ip_key_shape" CHECK ("auth_attempts"."scope" <> 'ip' OR "auth_attempts"."key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "custom_foods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "food_category" NOT NULL,
	"kcal" numeric(7, 2) NOT NULL,
	"protein" numeric(6, 2) NOT NULL,
	"carbs" numeric(6, 2) NOT NULL,
	"fat" numeric(6, 2) NOT NULL,
	"common_portions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "custom_foods_kcal_range" CHECK ("custom_foods"."kcal" >= 0 AND "custom_foods"."kcal" < 10000),
	CONSTRAINT "custom_foods_protein_range" CHECK ("custom_foods"."protein" >= 0 AND "custom_foods"."protein" < 1000),
	CONSTRAINT "custom_foods_carbs_range" CHECK ("custom_foods"."carbs" >= 0 AND "custom_foods"."carbs" < 1000),
	CONSTRAINT "custom_foods_fat_range" CHECK ("custom_foods"."fat" >= 0 AND "custom_foods"."fat" < 1000),
	CONSTRAINT "custom_foods_name_not_blank" CHECK (length(btrim("custom_foods"."name")) > 0),
	CONSTRAINT "custom_foods_common_portions_is_array" CHECK (jsonb_typeof("custom_foods"."common_portions") = 'array')
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"name" text NOT NULL,
	"grams" numeric(8, 2) NOT NULL,
	"kcal" numeric(9, 2) NOT NULL,
	"protein" numeric(7, 2) NOT NULL,
	"carbs" numeric(7, 2) NOT NULL,
	"fat" numeric(7, 2) NOT NULL,
	"meal" "meal_slot" NOT NULL,
	"source" "entry_source" NOT NULL,
	"food_id" text,
	"logged_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "entries_grams_range" CHECK ("entries"."grams" >= 0 AND "entries"."grams" < 100000),
	CONSTRAINT "entries_kcal_range" CHECK ("entries"."kcal" >= 0 AND "entries"."kcal" < 100000),
	CONSTRAINT "entries_protein_range" CHECK ("entries"."protein" >= 0 AND "entries"."protein" < 10000),
	CONSTRAINT "entries_carbs_range" CHECK ("entries"."carbs" >= 0 AND "entries"."carbs" < 10000),
	CONSTRAINT "entries_fat_range" CHECK ("entries"."fat" >= 0 AND "entries"."fat" < 10000),
	CONSTRAINT "entries_name_not_blank" CHECK (length(btrim("entries"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "favourites" (
	"user_id" uuid NOT NULL,
	"food_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "favourites_user_id_food_id_pk" PRIMARY KEY("user_id","food_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"sex" "sex" NOT NULL,
	"age" integer NOT NULL,
	"height_cm" numeric(5, 1) NOT NULL,
	"weight_kg" numeric(5, 1) NOT NULL,
	"activity" "activity_level" NOT NULL,
	"goal" "goal" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "profiles_age_range" CHECK ("profiles"."age" > 0 AND "profiles"."age" < 130),
	CONSTRAINT "profiles_height_range" CHECK ("profiles"."height_cm" > 0 AND "profiles"."height_cm" < 300),
	CONSTRAINT "profiles_weight_range" CHECK ("profiles"."weight_kg" > 0 AND "profiles"."weight_kg" < 500)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_shape" CHECK ("sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sessions_ip_hash_shape" CHECK ("sessions"."ip_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"reduced_motion" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"password_hash" text NOT NULL,
	"recovery_code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_email_not_blank" CHECK (length(btrim("users"."email")) > 0)
);
--> statement-breakpoint
CREATE TABLE "weights" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"weight_kg" numeric(5, 1) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "weights_weight_range" CHECK ("weights"."weight_kg" > 0 AND "weights"."weight_kg" < 500)
);
--> statement-breakpoint
ALTER TABLE "custom_foods" ADD CONSTRAINT "custom_foods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weights" ADD CONSTRAINT "weights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_attempts_window_idx" ON "auth_attempts" USING btree ("key","scope","action","created_at");--> statement-breakpoint
CREATE INDEX "auth_attempts_created_at_idx" ON "auth_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "custom_foods_user_updated_idx" ON "custom_foods" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "custom_foods_user_live_idx" ON "custom_foods" USING btree ("user_id") WHERE "custom_foods"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "entries_user_updated_idx" ON "entries" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "entries_user_day_idx" ON "entries" USING btree ("user_id","day") WHERE "entries"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "favourites_user_updated_idx" ON "favourites" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "profiles_user_updated_idx" ON "profiles" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_settings_user_updated_idx" ON "user_settings" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "weights_user_updated_idx" ON "weights" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "weights_user_day_live_key" ON "weights" USING btree ("user_id","day") WHERE "weights"."deleted_at" IS NULL;