const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const mime = require("mime-types");
const { Kafka } = require("kafkajs")

const PROJECT_ID = process.env.PROJECT_ID;
const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID

const kafka = new Kafka({
  clientId: `docker-build-server-${DEPLOYMENT_ID}`,
  brokers: ["15.207.1.102:9092"]
})
const producer = kafka.producer()

const s3Client = new S3Client({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function publishLog(log) {
  await producer.send({
    topic: `container-logs`, messages: [{
      key: "log", value: JSON.stringify({
        PROJECT_ID,
        DEPLOYMENT_ID,
        log
      })
    }]
  })
}

(async function init() {
  await producer.connect()
  console.log("Executing script...");
  publishLog("Build started...");
  const outDir = path.join(__dirname, "output");

  const p = exec(`cd ${outDir} && npm i && npm run build`);

  p.stdout.on("data", async (data) => {
    console.log(data.toString());
    await publishLog(data.toString());
  });

  p.stderr.on("data", (data) => {
    console.error("Build Log/Error:", data.toString());
  });

  p.on("error", async (err) => {
    console.error("Process error:", err);
    await publishLog("ERROR: ", err.toString());
  });

  p.on("close", async (code) => {
    if (code !== 0) {
      console.error(`Build failed with exit code ${code}`);
      return;
    }
    await publishLog("BUILD completed successfully...");
    console.log("BUILD completed successfully...");

    // Framework-agnostic path check (Vite uses 'dist', Next.js static export uses 'out', etc.)
    let distFolderPath = path.join(__dirname, "output", "dist");
    if (!fs.existsSync(distFolderPath)) {
      const outPath = path.join(__dirname, "output", "out");
      if (fs.existsSync(outPath)) distFolderPath = outPath;
    }

    const distFolderContent = fs.readdirSync(distFolderPath, {
      recursive: true,
    });
    await publishLog("starting to upload...");
    for (const relativePath of distFolderContent) {
      const absoluteFilePath = path.join(distFolderPath, relativePath);
      await publishLog("uploading file ", absoluteFilePath);
      if (fs.lstatSync(absoluteFilePath).isDirectory()) continue;
      console.log(`Uploading: ${relativePath}`);

      const s3Key = `__outputs/${PROJECT_ID}/${relativePath}`.replace(
        /\\/g,
        "/",
      );

      // FIX: Standardize lookups to handle modern compiled extensions (.mjs, .css, etc.)
      const resolvedMime = mime.lookup(absoluteFilePath);
      const contentType =
        resolvedMime === "application/javascript" ||
          absoluteFilePath.endsWith(".mjs")
          ? "application/javascript"
          : resolvedMime || "application/octet-stream";

      const command = new PutObjectCommand({
        Bucket: "ghoshkishanrana",
        Key: s3Key,
        ACL: "public-read",
        Body: fs.createReadStream(absoluteFilePath),
        ContentType: contentType,
      });

      try {
        await s3Client.send(command);
        console.log(`Uploaded: ${relativePath}`);
        await publishLog("uploaded: ", relativePath);
      } catch (uploadError) {
        console.error(`Failed to upload ${relativePath}:`, uploadError);
      }
    }
    await publishLog("All uploads completed.");

    console.log("All uploads completed.");
    process.exit(0)
  });
})();
