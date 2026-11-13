-- CreateEnum
CREATE TYPE "AgentJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "test_case" ADD COLUMN     "aiJobId" UUID,
ADD COLUMN     "aiNotes" JSONB;

-- CreateTable
CREATE TABLE "agent_job" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "agent" TEXT NOT NULL,
    "status" "AgentJobStatus" NOT NULL DEFAULT 'QUEUED',
    "sourceType" TEXT,
    "sourceIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "input" JSONB NOT NULL,
    "output" JSONB,
    "summary" TEXT,
    "error" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressMessage" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "agent_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "agentJobId" UUID,
    "agent" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_job_organizationId_createdAt_idx" ON "agent_job"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_job_projectId_createdAt_idx" ON "agent_job"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_organizationId_createdAt_idx" ON "ai_usage"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "agent_job" ADD CONSTRAINT "agent_job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_job" ADD CONSTRAINT "agent_job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_agentJobId_fkey" FOREIGN KEY ("agentJobId") REFERENCES "agent_job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Trigram similarity for duplicate detection (works without an embeddings provider).
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE INDEX IF NOT EXISTS "test_case_title_trgm_idx" ON "test_case" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "requirement_title_trgm_idx" ON "requirement" USING gin ("title" gin_trgm_ops);
