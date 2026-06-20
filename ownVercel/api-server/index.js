import { v4 as uuid } from "uuid"

import "dotenv/config";
import express from "express";
import { generateSlug } from "random-word-slugs";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import { Server } from "socket.io"
import { z } from "zod"
import { prisma } from "./lib/db.js";
import { createClient } from "@clickhouse/client"
import { Kafka } from "kafkajs"
import cors from "cors"

const kafka = new Kafka({
  clientId: `api-server`,
  brokers: ["15.207.1.102:9092"],
  logLevel: 'NOTHING'

})

const app = express();
const PORT = process.env.PORT ?? 9000;


const io = new Server({
  cors: {
    origin: "*",
  },
});


const client = createClient({
  url: "http://15.207.1.102:8123",
  username: "default",
  password: "",
  database: "default"
})

const consumer = kafka.consumer({ groupId: "api-server-logs-consumer" })

io.on("connection", (socket) => {
  socket.on("subscribe", (channel) => {
    socket.join(channel);
    socket.emit("message", `Subscribed to ${channel}`);
  })
})
io.listen(9001, () => {
  console.log("Socket.IO server is listening on port 9001");
});

const ecsClient = new ECSClient({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const config = {
  CLUSTER: "arn:aws:ecs:ap-south-1:217797467578:cluster/builder-cluster",
  TASK: "arn:aws:ecs:ap-south-1:217797467578:task-definition/builder-task",
};
app.use(cors())
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post("/project", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    githubUrl: z.string()
  })
  const safeParseResult = schema.safeParse(req.body)

  if (safeParseResult.error) {
    return res.status(400).json({ error: safeParseResult.error.flatten() });
  }
  const { name, githubUrl } = safeParseResult.data
  const subdomain = generateSlug();

  const project = await prisma.project.create({
    data: {
      name,
      gitUrl: githubUrl,
      subdomain
    }
  })

  return res.json({ status: "success", data: project });

})

app.post("/deploy", async (req, res) => {
  const { projectId } = req.body;

  // Create project in DB
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) {
    return res.json({ err: "project not found" })
  }


  // Create deployment record
  const deployment = await prisma.deployment.create({
    data: {
      projectId: project.id,
      status: "PENDING",
    }
  });

  // spin the container

  const command = new RunTaskCommand({
    cluster: config.CLUSTER,
    taskDefinition: config.TASK,
    launchType: "FARGATE",
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: {
        assignPublicIp: "ENABLED",
        subnets: [
          "subnet-02f1b85e465537d7a",
          "subnet-0b8f2a02fb1a4eecc",
          "subnet-0629cfdf95b50b6c5",
        ],
        securityGroups: ["sg-0cdb7d2e9456cca60"],
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: "builder-image",
          environment: [
            { name: "GIT_REPOSITORY_URL", value: project.gitUrl },
            { name: "AWS_ACCESS_KEY_ID", value: process.env.AWS_ACCESS_KEY_ID },
            {
              name: "AWS_SECRET_ACCESS_KEY",
              value: process.env.AWS_SECRET_ACCESS_KEY,
            },
            { name: "PROJECT_ID", value: project.id },
            { name: "DEPLOYMENT_ID", value: deployment.id },
          ],
        },
      ],
    },
  });
  await ecsClient.send(command);
  return res.json({
    status: "queued",
    data: { deploymentId: deployment.id },
  });
});

app.get("/logs/:id", async (req, res) => {
  const id = req.params.id
  const logs = await client.query(({
    query: "SELECT event_id, deployment_id, log from log_events where deployment_id = {deployment_id:String}",
    query_params: {
      deployment_id: id
    },
    format: "JSONEachRow"
  }))
  const rawLogs = await logs.json()
  return res.json({ logs: rawLogs })


})

async function initKafkaConsumer() {
  await consumer.connect()
  await consumer.subscribe({ topics: ["container-logs"] })
  await consumer.run(
    {
      autoCommit: false,
      eachBatch: async function ({ batch, heartbeat, resolveOffset, commitOffsetsIfNecessary }) {
        const messages = batch.messages
        console.log(`Received ${messages.length} messages`);

        for (const message of messages) {
          const stringMessage = message.value.toString()
          const { PROJECT_ID, DEPLOYMENT_ID, log } = JSON.parse(stringMessage)

          const { query_id } = await client.insert({
            table: "log_events",
            values: [
              {
                event_id: uuid(),
                deployment_id: DEPLOYMENT_ID,
                log: log,
              }
            ],
            format: "JSONEachRow"
          })
          console.log("inserted ", query_id);

          commitOffsetsIfNecessary()
          resolveOffset(message.offset)
          await heartbeat()

        }

      }
    })
}
initKafkaConsumer()
app.listen(PORT, () => {
  console.log(`Api Server is listening at PORT ${PORT}`);
});
