FROM ubuntu

RUN apt-get update
RUN apt-get install -y curl

RUN apt-get install -y nodejs
RUN apt-get install -y git
RUN apt-get install -y npm

WORKDIR /home/app

COPY main.sh main.sh
COPY script.js script.js
COPY package*.json .

RUN npm install

RUN chmod +x main.sh
RUN chmod +x script.js

ENTRYPOINT [ "/home/app/main.sh" ]