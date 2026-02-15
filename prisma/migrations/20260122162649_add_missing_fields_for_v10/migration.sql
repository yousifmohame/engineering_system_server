-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "projectClassification" TEXT;

-- AlterTable
ALTER TABLE "TransactionType" ADD COLUMN     "defaultCosts" JSONB;
