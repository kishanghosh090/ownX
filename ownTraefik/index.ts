import http from "http";
import express from "express";
import Docker from "dockerode";

// docker rode setup
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const app = express();
const PORT = process.env.PORT ?? 8080;

app.use(express.json());

app.post("/container", async (req, res) => {
  const { image, tag = "latest" } = req.body;
  const Image = `${image}:${tag}`;

  const images = await docker.listImages();
  let isImageAlreadyExists = false;

  for (const sysImagesWithTag of images) {
    if (
      typeof sysImagesWithTag == "object" &&
      sysImagesWithTag.RepoTags != undefined
    ) {
      for (const sysImage of sysImagesWithTag.RepoTags) {
        if (sysImage == Image) {
          isImageAlreadyExists = true;
          break;
        }
      }
      if (isImageAlreadyExists) break;
    }
  }

  if (!isImageAlreadyExists) {
    console.log(`Pulling Image: ${Image} ...`);
    await docker.pull(Image);
  }

  const container = await docker.createContainer({
    Image: Image,
    Tty: false,
    HostConfig: {
      AutoRemove: true,
    },
  });

  await container.start();

  return res.status(201).json({
    status: "success",
    container: `${(await container.inspect()).Name}.localhost`,
  });
});

app.listen(PORT, () => {
  console.log(`Server is listing at PORT ${PORT}`);
});
