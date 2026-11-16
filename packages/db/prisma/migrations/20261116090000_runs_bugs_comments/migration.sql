-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "TestRunStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED');

-- CreateEnum
CREATE TYPE "TestRunSource" AS ENUM ('SUITE', 'FILTER', 'RELEASE', 'MANUAL', 'AUTOMATION');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('UNTESTED', 'PASSED', 'FAILED', 'BLOCKED', 'SKIPPED', 'RETEST');

-- CreateEnum
CREATE TYPE "BugSeverity" AS ENUM ('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL');

-- CreateEnum
CREATE TYPE "BugStatus" AS ENUM ('NEW', 'TRIAGED', 'IN_PROGRESS', 'FIXED', 'READY_FOR_RETEST', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "BugResolution" AS ENUM ('FIXED', 'DUPLICATE', 'WONT_FIX', 'CANNOT_REPRODUCE', 'BY_DESIGN');

-- CreateEnum
CREATE TYPE "CustomFieldEntity" AS ENUM ('REQUIREMENT', 'TEST_CASE', 'TEST_RUN', 'BUG');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'SELECT', 'MULTI_SELECT', 'USER', 'URL');

-- AlterTable
ALTER TABLE "attachment" ADD COLUMN     "annotations" JSONB,
ADD COLUMN     "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "scannedAt" TIMESTAMP(3),
ADD COLUMN     "sha256" TEXT;

-- AlterTable
ALTER TABLE "requirement" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "test_case" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "project_member" (
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_member_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "test_run" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "TestRunStatus" NOT NULL DEFAULT 'PLANNED',
    "source" "TestRunSource" NOT NULL DEFAULT 'MANUAL',
    "sourceConfig" JSONB NOT NULL DEFAULT '{}',
    "environmentId" UUID,
    "build" TEXT,
    "releaseId" UUID,
    "dueAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "test_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_run_result" (
    "id" UUID NOT NULL,
    "testRunId" UUID NOT NULL,
    "testCaseId" UUID,
    "testCaseVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "dataRowIndex" INTEGER,
    "position" INTEGER NOT NULL,
    "status" "ResultStatus" NOT NULL DEFAULT 'UNTESTED',
    "stepResults" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "assigneeId" UUID,
    "executedById" UUID,
    "executedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "automationResultId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_run_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bug" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" JSONB,
    "descriptionText" TEXT NOT NULL DEFAULT '',
    "stepsToReproduce" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectedResult" TEXT NOT NULL DEFAULT '',
    "actualResult" TEXT NOT NULL DEFAULT '',
    "envDetails" JSONB NOT NULL DEFAULT '{}',
    "environmentId" UUID,
    "severity" "BugSeverity" NOT NULL DEFAULT 'MAJOR',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "component" TEXT,
    "status" "BugStatus" NOT NULL DEFAULT 'NEW',
    "resolution" "BugResolution",
    "duplicateOfId" UUID,
    "assigneeId" UUID,
    "testRunResultId" UUID,
    "failedStepIndex" INTEGER,
    "rank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiNotes" JSONB,
    "aiJobId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_case_bug" (
    "testCaseId" UUID NOT NULL,
    "bugId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_case_bug_pkey" PRIMARY KEY ("testCaseId","bugId")
);

-- CreateTable
CREATE TABLE "comment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "body" JSONB NOT NULL,
    "bodyText" TEXT NOT NULL,
    "mentions" UUID[] DEFAULT ARRAY[]::UUID[],
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "entity" "CustomFieldEntity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "entity" "CustomFieldEntity" NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "entityType" TEXT,
    "entityId" UUID,
    "url" TEXT,
    "actorId" UUID,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_member_userId_idx" ON "project_member"("userId");

-- CreateIndex
CREATE INDEX "test_run_projectId_status_idx" ON "test_run"("projectId", "status");

-- CreateIndex
CREATE INDEX "test_run_releaseId_idx" ON "test_run"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "test_run_projectId_seq_key" ON "test_run"("projectId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "test_run_result_automationResultId_key" ON "test_run_result"("automationResultId");

-- CreateIndex
CREATE INDEX "test_run_result_testRunId_position_idx" ON "test_run_result"("testRunId", "position");

-- CreateIndex
CREATE INDEX "test_run_result_testRunId_status_idx" ON "test_run_result"("testRunId", "status");

-- CreateIndex
CREATE INDEX "test_run_result_assigneeId_status_idx" ON "test_run_result"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "test_run_result_testCaseId_idx" ON "test_run_result"("testCaseId");

-- CreateIndex
CREATE INDEX "bug_projectId_status_rank_idx" ON "bug"("projectId", "status", "rank");

-- CreateIndex
CREATE INDEX "bug_projectId_severity_idx" ON "bug"("projectId", "severity");

-- CreateIndex
CREATE INDEX "bug_assigneeId_status_idx" ON "bug"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "bug_title_trgm_idx" ON "bug" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "bug_projectId_seq_key" ON "bug"("projectId", "seq");

-- CreateIndex
CREATE INDEX "test_case_bug_bugId_idx" ON "test_case_bug"("bugId");

-- CreateIndex
CREATE INDEX "comment_entityType_entityId_createdAt_idx" ON "comment"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_projectId_entity_key_key" ON "custom_field"("projectId", "entity", "key");

-- CreateIndex
CREATE UNIQUE INDEX "template_projectId_entity_name_key" ON "template"("projectId", "entity", "name");

-- CreateIndex
CREATE INDEX "notification_userId_readAt_createdAt_idx" ON "notification"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_run" ADD CONSTRAINT "test_run_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_run" ADD CONSTRAINT "test_run_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_run_result" ADD CONSTRAINT "test_run_result_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "test_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_run_result" ADD CONSTRAINT "test_run_result_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug" ADD CONSTRAINT "bug_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug" ADD CONSTRAINT "bug_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug" ADD CONSTRAINT "bug_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "bug"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug" ADD CONSTRAINT "bug_testRunResultId_fkey" FOREIGN KEY ("testRunResultId") REFERENCES "test_run_result"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case_bug" ADD CONSTRAINT "test_case_bug_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case_bug" ADD CONSTRAINT "test_case_bug_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template" ADD CONSTRAINT "template_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

