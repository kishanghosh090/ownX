import SMTPServer from "smtp-server";

// reciving mail
const server = new SMTPServer.SMTPServer({
  allowInsecureAuth: true,
  authOptional: true,
  hideSTARTTLS: true,
  disabledCommands: ["AUTH"],
  onConnect(session, callback) {
    console.log("Client connected:", session.remoteAddress);
    console.log("Session id:", session.id);

    callback(); // Accept the connection [if we want to rejct the connection ... new Error("some error") -> reject the connectinon]
  },
  onAuth(auth, session, callback) {
    callback(undefined);
  },
  onMailFrom(address, session, callback) {
    console.log("mail from ", address.address);
    console.log("session id ", session.id);

    // accepted
    callback();
  },
  onRcptTo(address, session, callback) {
    console.log("mail send to ", address.address);
    // check in db if user is exist or not in our mail service db
    console.log("session id ", session.id);
    callback();
  },
  onData(stream, session, callback) {
    let data = "";
    stream.on("data", (chunk) => {
      // save data to our db
      data += chunk.toString();
      console.log("Data recived", chunk);
    });
    stream.on("end", () => {
      console.log("stream end...");
      console.log("Full email data:", data);
      callback();
    });
    stream.on("error", (err) => {
      console.log("Error :", err.message);
      callback(new Error("Failed to recive data"));
    });
  },
});

server.listen(25, () => {
  console.log("SMTP server is listening on port 25");
});
