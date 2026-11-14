CREATE TABLE `addons` (
	`simulator` text NOT NULL,
	`folderName` text NOT NULL,
	`folderPath` text NOT NULL,
	`name` text NOT NULL,
	`version` text,
	`creator` text,
	`contentType` text,
	`manifestJson` text NOT NULL,
	CONSTRAINT `addons_pk` PRIMARY KEY(`simulator`, `folderName`)
);
--> statement-breakpoint
CREATE TABLE `simulator_settings` (
	`simulator` text PRIMARY KEY,
	`communityPath` text,
	`scannedPath` text,
	`scannedAt` text
);
