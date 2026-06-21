import SMTPServer from "smtp-server";

// reciving mail
const server = new SMTPServer.SMTPServer({
  allowInsecureAuth: true,
  onConnect(session, callback) {
    console.log("Client connected:", session.remoteAddress);
    console.log("Session id:", session.id);

    callback(); // Accept the connection [if we want to rejct the connection ... new Error("some error") -> reject the connectinon]
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
  },
  onData(stream, session, callback) {
    stream.on("data", (chunk) => {
      // save data to our db
      console.log("Data recived", chunk);
    });
    stream.on("end", () => {
      console.log("stream end...");
      callback();
    });
    stream.on("error", (err) => {
      console.log("Error :", err.message);
    });
    callback(new Error("Failed to recive data"));
  },
});

server.listen(25, () => {
  console.log("SMTP server is listening on port 25");
});
