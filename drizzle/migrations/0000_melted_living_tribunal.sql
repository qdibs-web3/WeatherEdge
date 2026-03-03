CREATE TABLE `bot_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`polymarketPrivateKey` text,
	`polymarketFunderAddress` varchar(255),
	`maxPositionSize` decimal(10,2) NOT NULL DEFAULT '50.00',
	`maxOpenPositions` int NOT NULL DEFAULT 5,
	`maxDailyLoss` decimal(10,2) NOT NULL DEFAULT '25.00',
	`targetDailyReturn` decimal(5,4) NOT NULL DEFAULT '0.0200',
	`minEdge` decimal(5,4) NOT NULL DEFAULT '0.0500',
	`kellyFraction` decimal(5,4) NOT NULL DEFAULT '0.2500',
	`arbitrageEnabled` boolean NOT NULL DEFAULT true,
	`arbitrageMinProfitPct` decimal(5,2) NOT NULL DEFAULT '0.80',
	`valueBettingEnabled` boolean NOT NULL DEFAULT false,
	`highQualityMarketsEnabled` boolean NOT NULL DEFAULT true,
	`minVolume` decimal(12,2) NOT NULL DEFAULT '5000.00',
	`minQualityScore` int NOT NULL DEFAULT 60,
	`runIntervalSeconds` int NOT NULL DEFAULT 60,
	`isActive` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bot_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`level` enum('debug','info','warning','error') NOT NULL,
	`message` text NOT NULL,
	`context` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bot_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bot_status` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('stopped','running','error','paused') NOT NULL DEFAULT 'stopped',
	`lastStartedAt` timestamp,
	`lastStoppedAt` timestamp,
	`errorMessage` text,
	`currentBalance` decimal(12,2) NOT NULL DEFAULT '0.00',
	`startOfDayBalance` decimal(12,2) NOT NULL DEFAULT '0.00',
	`dailyPnl` decimal(12,2) NOT NULL DEFAULT '0.00',
	`totalPnl` decimal(12,2) NOT NULL DEFAULT '0.00',
	`totalTrades` int NOT NULL DEFAULT 0,
	`winningTrades` int NOT NULL DEFAULT 0,
	`losingTrades` int NOT NULL DEFAULT 0,
	`openPositionsCount` int NOT NULL DEFAULT 0,
	`lastCycleAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_status_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_status_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `market_opportunities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`marketId` varchar(255) NOT NULL,
	`marketQuestion` text NOT NULL,
	`opportunityType` enum('arbitrage','value_bet','high_quality') NOT NULL,
	`yesPrice` decimal(10,6),
	`noPrice` decimal(10,6),
	`combinedCost` decimal(10,6),
	`profitPct` decimal(8,4),
	`volume` decimal(12,2),
	`liquidity` decimal(12,2),
	`qualityScore` int,
	`maxPosition` decimal(12,2),
	`scannedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `market_opportunities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `performance_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`date` timestamp NOT NULL,
	`startingBalance` decimal(12,2) NOT NULL,
	`endingBalance` decimal(12,2) NOT NULL,
	`dailyPnl` decimal(12,2) NOT NULL,
	`dailyReturn` decimal(8,4) NOT NULL,
	`tradesCount` int NOT NULL DEFAULT 0,
	`winningTrades` int NOT NULL DEFAULT 0,
	`losingTrades` int NOT NULL DEFAULT 0,
	`winRate` decimal(5,2),
	`profitFactor` decimal(8,4),
	`sharpeRatio` decimal(8,4),
	`maxDrawdown` decimal(8,4),
	`arbitrageProfit` decimal(12,2) DEFAULT '0.00',
	`valueBettingProfit` decimal(12,2) DEFAULT '0.00',
	`highQualityProfit` decimal(12,2) DEFAULT '0.00',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `performance_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tradeId` int NOT NULL,
	`marketId` varchar(255) NOT NULL,
	`marketQuestion` text NOT NULL,
	`strategy` enum('arbitrage','value_betting','high_quality') NOT NULL,
	`side` enum('yes','no','both') NOT NULL,
	`entryPrice` decimal(10,6) NOT NULL,
	`currentPrice` decimal(10,6) NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`entryValue` decimal(12,2) NOT NULL,
	`currentValue` decimal(12,2) NOT NULL,
	`unrealizedPnl` decimal(12,2) NOT NULL,
	`unrealizedPnlPct` decimal(8,4) NOT NULL,
	`openedAt` timestamp NOT NULL,
	`lastUpdatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`),
	CONSTRAINT `positions_tradeId_unique` UNIQUE(`tradeId`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`marketId` varchar(255) NOT NULL,
	`marketQuestion` text NOT NULL,
	`strategy` enum('arbitrage','value_betting','high_quality') NOT NULL,
	`side` enum('yes','no','both') NOT NULL,
	`entryPrice` decimal(10,6) NOT NULL,
	`exitPrice` decimal(10,6),
	`quantity` decimal(12,2) NOT NULL,
	`entryValue` decimal(12,2) NOT NULL,
	`exitValue` decimal(12,2),
	`pnl` decimal(12,2),
	`pnlPct` decimal(8,4),
	`status` enum('open','closed','cancelled') NOT NULL DEFAULT 'open',
	`entryTime` timestamp NOT NULL,
	`exitTime` timestamp,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `trades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
