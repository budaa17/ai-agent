CREATE TABLE "EvalCase" (
    "id" TEXT NOT NULL,
    "suite" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "inputText" TEXT NOT NULL,
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "expectedOutput" JSONB NOT NULL,
    "scoredFields" TEXT[],
    "tags" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvalCase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvalCase_suite_enabled_idx" ON "EvalCase"("suite", "enabled");
