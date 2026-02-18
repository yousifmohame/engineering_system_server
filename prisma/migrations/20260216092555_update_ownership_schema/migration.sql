-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "official_name_ar" TEXT,
ADD COLUMN     "riskTier" TEXT NOT NULL DEFAULT 'LOW';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "ownershipId" TEXT;

-- CreateTable
CREATE TABLE "OwnershipFile" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "deedNumber" TEXT,
    "deedDate" DATE,
    "issuingAuthority" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "city" TEXT,
    "district" TEXT,
    "planNumber" TEXT,
    "blockNumber" TEXT,
    "plotNumber" TEXT,
    "area" DOUBLE PRECISION,
    "centerLat" DOUBLE PRECISION,
    "centerLng" DOUBLE PRECISION,
    "boundaries" JSONB,
    "notes" TEXT,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnershipFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAnalysisLog" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION,
    "extractedData" JSONB NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "ownershipId" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIAnalysisLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnershipFile_code_key" ON "OwnershipFile"("code");

-- CreateIndex
CREATE UNIQUE INDEX "OwnershipFile_deedNumber_key" ON "OwnershipFile"("deedNumber");

-- CreateIndex
CREATE INDEX "OwnershipFile_deedNumber_idx" ON "OwnershipFile"("deedNumber");

-- CreateIndex
CREATE INDEX "OwnershipFile_district_idx" ON "OwnershipFile"("district");

-- CreateIndex
CREATE INDEX "OwnershipFile_clientId_idx" ON "OwnershipFile"("clientId");

-- AddForeignKey
ALTER TABLE "OwnershipFile" ADD CONSTRAINT "OwnershipFile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAnalysisLog" ADD CONSTRAINT "AIAnalysisLog_ownershipId_fkey" FOREIGN KEY ("ownershipId") REFERENCES "OwnershipFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_ownershipId_fkey" FOREIGN KEY ("ownershipId") REFERENCES "OwnershipFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
