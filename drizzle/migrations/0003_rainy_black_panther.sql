CREATE TABLE `payment_audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`eventType` varchar(100) NOT NULL,
	`stripeEventId` varchar(255),
	`amount` decimal(12,2),
	`currency` varchar(3) DEFAULT 'usd',
	`subscriptionTier` varchar(50),
	`stripeCustomerId` varchar(255),
	`stripeSubscriptionId` varchar(255),
	`metadata` json,
	`ipAddress` varchar(45),
	`userAgent` text,
	`status` enum('pending','success','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`endpoint` varchar(255) NOT NULL,
	`requestCount` int NOT NULL DEFAULT 1,
	`windowStart` timestamp NOT NULL DEFAULT (now()),
	`blocked` boolean NOT NULL DEFAULT false,
	`blockedUntil` timestamp,
	CONSTRAINT `rate_limits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stripeEventId` varchar(255) NOT NULL,
	`eventType` varchar(100) NOT NULL,
	`payload` json NOT NULL,
	`processed` boolean NOT NULL DEFAULT false,
	`processedAt` timestamp,
	`retryCount` int NOT NULL DEFAULT 0,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhook_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `webhook_events_stripeEventId_unique` UNIQUE(`stripeEventId`)
);
