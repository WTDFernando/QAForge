-- CreateEnum
CREATE TYPE "HttpMethod" AS ENUM ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS');

-- CreateEnum
CREATE TYPE "AutomationTestStatus" AS ENUM ('ACTIVE', 'QUARANTINED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('MANUAL', 'SCHEDULE', 'CI_WEBHOOK', 'API');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FailureClass" AS ENUM ('PRODUCT_BUG', 'TEST_BUG', 'FLAKY', 'ENVIRONMENT');

-- CreateTable
CREATE TABLE "api_collection" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "variables" JSONB NOT NULL DEFAULT '{}',
    "auth" JSONB NOT NULL DEFAULT '{"type":"none"}',
    "position" INTEGER NOT NULL DEFAULT 0,
    "importedFrom" JSONB,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_request" (
    "id" UUID NOT NULL,
    "collectionId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "method" "HttpMethod" NOT NULL DEFAULT 'GET',
    "url" TEXT NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '[]',
    "query" JSONB NOT NULL DEFAULT '[]',
    "body" JSONB NOT NULL DEFAULT '{"type":"none"}',
    "auth" JSONB,
    "assertions" JSONB NOT NULL DEFAULT '[]',
    "extract" JSONB NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL DEFAULT 0,
    "testCaseId" UUID,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_test" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "AutomationTestStatus" NOT NULL DEFAULT 'ACTIVE',
    "testCaseId" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "flakyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiJobId" UUID,
    "pendingFix" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "automation_test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_test_version" (
    "id" UUID NOT NULL,
    "automationTestId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'edit',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_test_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_run" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "trigger" "AutomationTrigger" NOT NULL,
    "triggerRef" TEXT,
    "idempotencyKey" TEXT,
    "selection" JSONB NOT NULL,
    "environmentId" UUID,
    "build" TEXT,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "retries" INTEGER NOT NULL DEFAULT 1,
    "totals" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "testRunId" UUID,
    "scheduleId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "automation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_result" (
    "id" UUID NOT NULL,
    "automationRunId" UUID NOT NULL,
    "automationTestId" UUID,
    "apiRequestId" UUID,
    "name" TEXT NOT NULL,
    "status" "ResultStatus" NOT NULL,
    "flaky" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "durationMs" INTEGER,
    "error" TEXT,
    "log" TEXT,
    "exchange" JSONB,
    "failureClass" "FailureClass",
    "analysis" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_schedule" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "selection" JSONB NOT NULL,
    "environmentId" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_token" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['automation:run']::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_collection_projectId_parentId_position_idx" ON "api_collection"("projectId", "parentId", "position");

-- CreateIndex
CREATE INDEX "api_request_collectionId_position_idx" ON "api_request"("collectionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "automation_test_projectId_path_key" ON "automation_test"("projectId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "automation_test_version_automationTestId_version_key" ON "automation_test_version"("automationTestId", "version");

-- CreateIndex
CREATE INDEX "automation_run_projectId_createdAt_idx" ON "automation_run"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "automation_run_projectId_seq_key" ON "automation_run"("projectId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "automation_run_projectId_idempotencyKey_key" ON "automation_run"("projectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "automation_result_automationRunId_position_idx" ON "automation_result"("automationRunId", "position");

-- CreateIndex
CREATE INDEX "automation_result_automationTestId_createdAt_idx" ON "automation_result"("automationTestId", "createdAt");

-- CreateIndex
CREATE INDEX "automation_schedule_enabled_nextRunAt_idx" ON "automation_schedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_token_tokenHash_key" ON "project_token"("tokenHash");

-- CreateIndex
CREATE INDEX "project_token_projectId_idx" ON "project_token"("projectId");

-- AddForeignKey
ALTER TABLE "test_run_result" ADD CONSTRAINT "test_run_result_automationResultId_fkey" FOREIGN KEY ("automationResultId") REFERENCES "automation_result"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_collection" ADD CONSTRAINT "api_collection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_collection" ADD CONSTRAINT "api_collection_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "api_collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_request" ADD CONSTRAINT "api_request_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "api_collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_request" ADD CONSTRAINT "api_request_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_test" ADD CONSTRAINT "automation_test_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_test" ADD CONSTRAINT "automation_test_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_test_version" ADD CONSTRAINT "automation_test_version_automationTestId_fkey" FOREIGN KEY ("automationTestId") REFERENCES "automation_test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "test_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "automation_schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_result" ADD CONSTRAINT "automation_result_automationRunId_fkey" FOREIGN KEY ("automationRunId") REFERENCES "automation_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_result" ADD CONSTRAINT "automation_result_automationTestId_fkey" FOREIGN KEY ("automationTestId") REFERENCES "automation_test"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_result" ADD CONSTRAINT "automation_result_apiRequestId_fkey" FOREIGN KEY ("apiRequestId") REFERENCES "api_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_schedule" ADD CONSTRAINT "automation_schedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_schedule" ADD CONSTRAINT "automation_schedule_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_token" ADD CONSTRAINT "project_token_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

