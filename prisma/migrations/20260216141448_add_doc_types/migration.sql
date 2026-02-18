-- CreateTable
CREATE TABLE "DocumentType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "classification" TEXT NOT NULL,
    "allowedExtensions" TEXT[],
    "maxSizeMB" INTEGER NOT NULL DEFAULT 5,
    "requiresSignature" BOOLEAN NOT NULL DEFAULT false,
    "confidentiality" TEXT NOT NULL DEFAULT 'General',
    "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_code_key" ON "DocumentType"("code");
