-- CreateEnum
CREATE TYPE "AffiliateType" AS ENUM ('organization', 'creator');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "CommissionKind" AS ENUM ('percentage', 'fixed_item');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "type" "AffiliateType" NOT NULL DEFAULT 'organization';

-- AlterTable
ALTER TABLE "ProductAssignment" ADD COLUMN     "programVersionId" UUID;

-- AlterTable
ALTER TABLE "CommissionTransaction" ADD COLUMN     "fixedMinor" BIGINT,
ADD COLUMN     "kind" "CommissionKind" NOT NULL DEFAULT 'percentage',
ADD COLUMN     "programVersionId" UUID,
ADD COLUMN     "refundedQuantity" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "rateId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AffiliateAccount" (
    "id" UUID NOT NULL,
    "type" "AffiliateType" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "organizationRole" TEXT,
    "paypalEmail" TEXT NOT NULL,
    "authSubject" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "organizationId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AffiliateAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionProgram" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramVersion" (
    "id" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "CommissionKind" NOT NULL,
    "rateBps" INTEGER NOT NULL DEFAULT 0,
    "fixedMinor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" UUID NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "resourceGid" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "claimedAt" TIMESTAMPTZ(3),
    "claimToken" UUID,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateAccount_email_key" ON "AffiliateAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateAccount_authSubject_key" ON "AffiliateAccount"("authSubject");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateAccount_organizationId_key" ON "AffiliateAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_shop_topic_eventId_key" ON "WebhookDelivery"("shop", "topic", "eventId");

-- AddForeignKey
ALTER TABLE "AffiliateAccount" ADD CONSTRAINT "AffiliateAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramVersion" ADD CONSTRAINT "ProgramVersion_programId_fkey" FOREIGN KEY ("programId") REFERENCES "CommissionProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAssignment" ADD CONSTRAINT "ProductAssignment_programVersionId_fkey" FOREIGN KEY ("programVersionId") REFERENCES "ProgramVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_programVersionId_fkey" FOREIGN KEY ("programVersionId") REFERENCES "ProgramVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
