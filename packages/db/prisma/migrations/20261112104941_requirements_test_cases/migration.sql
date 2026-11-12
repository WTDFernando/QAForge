-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('EPIC', 'FEATURE', 'STORY');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('DRAFT', 'APPROVED', 'OBSOLETE');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('FILE', 'LINK', 'JIRA', 'GITLAB');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "TestCaseStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "TestCaseType" AS ENUM ('FUNCTIONAL', 'UI', 'API', 'REGRESSION', 'SMOKE', 'SECURITY', 'PERFORMANCE', 'ACCESSIBILITY');

-- CreateEnum
CREATE TYPE "TestTechnique" AS ENUM ('POSITIVE', 'NEGATIVE', 'BOUNDARY', 'EQUIVALENCE', 'DECISION_TABLE', 'STATE_TRANSITION', 'EDGE_CASE', 'EXPLORATORY');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('NOT_AUTOMATED', 'CANDIDATE', 'AUTOMATED', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "environment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "secrets" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "environment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "entityType" TEXT,
    "entityId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_source" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "attachmentId" UUID,
    "url" TEXT,
    "status" "SourceStatus" NOT NULL DEFAULT 'UPLOADED',
    "analysis" JSONB,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirement_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "RequirementType" NOT NULL DEFAULT 'STORY',
    "title" TEXT NOT NULL,
    "description" JSONB,
    "descriptionText" TEXT NOT NULL DEFAULT '',
    "acceptanceCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "RequirementStatus" NOT NULL DEFAULT 'DRAFT',
    "parentId" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "sourceId" UUID,
    "clarityScore" INTEGER,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_version" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirement_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_suite" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_suite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_case" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "suiteId" UUID,
    "title" TEXT NOT NULL,
    "preconditions" TEXT NOT NULL DEFAULT '',
    "testData" JSONB,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "type" "TestCaseType" NOT NULL DEFAULT 'FUNCTIONAL',
    "technique" "TestTechnique",
    "status" "TestCaseStatus" NOT NULL DEFAULT 'DRAFT',
    "automationStatus" "AutomationStatus" NOT NULL DEFAULT 'NOT_AUTOMATED',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimateMinutes" INTEGER,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiConfidence" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "test_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_step" (
    "id" UUID NOT NULL,
    "testCaseId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "action" TEXT NOT NULL DEFAULT '',
    "expected" TEXT NOT NULL DEFAULT '',
    "sharedStepId" UUID,

    CONSTRAINT "test_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_step" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_case_version" (
    "id" UUID NOT NULL,
    "testCaseId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_case_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_test_case" (
    "requirementId" UUID NOT NULL,
    "testCaseId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirement_test_case_pkey" PRIMARY KEY ("requirementId","testCaseId")
);

-- CreateTable
CREATE TABLE "saved_view" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "ownerId" UUID NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_view_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "environment_projectId_name_key" ON "environment"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "attachment_storageKey_key" ON "attachment"("storageKey");

-- CreateIndex
CREATE INDEX "attachment_entityType_entityId_idx" ON "attachment"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "requirement_source_projectId_createdAt_idx" ON "requirement_source"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "requirement_projectId_parentId_position_idx" ON "requirement"("projectId", "parentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "requirement_projectId_seq_key" ON "requirement"("projectId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "requirement_version_requirementId_version_key" ON "requirement_version"("requirementId", "version");

-- CreateIndex
CREATE INDEX "test_suite_projectId_parentId_position_idx" ON "test_suite"("projectId", "parentId", "position");

-- CreateIndex
CREATE INDEX "test_case_projectId_suiteId_idx" ON "test_case"("projectId", "suiteId");

-- CreateIndex
CREATE INDEX "test_case_projectId_status_idx" ON "test_case"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "test_case_projectId_seq_key" ON "test_case"("projectId", "seq");

-- CreateIndex
CREATE INDEX "test_step_testCaseId_position_idx" ON "test_step"("testCaseId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "shared_step_projectId_name_key" ON "shared_step"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "test_case_version_testCaseId_version_key" ON "test_case_version"("testCaseId", "version");

-- CreateIndex
CREATE INDEX "requirement_test_case_testCaseId_idx" ON "requirement_test_case"("testCaseId");

-- CreateIndex
CREATE INDEX "saved_view_projectId_entity_idx" ON "saved_view"("projectId", "entity");

-- AddForeignKey
ALTER TABLE "environment" ADD CONSTRAINT "environment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_source" ADD CONSTRAINT "requirement_source_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_source" ADD CONSTRAINT "requirement_source_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "requirement_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_version" ADD CONSTRAINT "requirement_version_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_suite" ADD CONSTRAINT "test_suite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_suite" ADD CONSTRAINT "test_suite_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "test_suite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case" ADD CONSTRAINT "test_case_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case" ADD CONSTRAINT "test_case_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "test_suite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_step" ADD CONSTRAINT "test_step_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_step" ADD CONSTRAINT "test_step_sharedStepId_fkey" FOREIGN KEY ("sharedStepId") REFERENCES "shared_step"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_step" ADD CONSTRAINT "shared_step_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case_version" ADD CONSTRAINT "test_case_version_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_test_case" ADD CONSTRAINT "requirement_test_case_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_test_case" ADD CONSTRAINT "requirement_test_case_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
