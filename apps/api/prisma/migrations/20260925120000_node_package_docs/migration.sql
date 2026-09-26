-- CreateTable
CREATE TABLE "InstanceNodePackage" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "version" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceNodePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodePackageDoc" (
    "id" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "url" TEXT,
    "content" TEXT NOT NULL,
    "updatedBy" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodePackageDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstanceNodePackage_instanceId_packageName_key" ON "InstanceNodePackage"("instanceId", "packageName");

-- CreateIndex
CREATE INDEX "NodePackageDoc_packageName_idx" ON "NodePackageDoc"("packageName");

-- CreateIndex
CREATE UNIQUE INDEX "NodePackageDoc_packageName_kind_version_key" ON "NodePackageDoc"("packageName", "kind", "version");

-- AddForeignKey
ALTER TABLE "InstanceNodePackage" ADD CONSTRAINT "InstanceNodePackage_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
