import "dotenv/config";
import fs from "fs-extra";
import schedule from "node-schedule";
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import bot from "./bot.js";
import moderation from "./moderation.js";

let queue = [];

async function log(...data) {
    const str = `${(new Date()).toISOString()}: ${data.join(" ")}`;
    console.log(str);
    const channel = moderation.client.channels.cache.find(channel => channel.id === process.env.DISCORD_LOG_CHANNEL_ID);
    await channel.send(str);
    fs.appendFileSync(path.join(__dirname, "data/log.txt"), str+"\n");
}

async function run() {
    //THE PROBLEM LINES
    //while (queue.length === 0);
    //    addPlatesToQueue(await moderation._process());
    
    await bot.post(queue.pop());
    fs.writeFileSync("./data/queue.json", JSON.stringify(queue));
    
    moderation.updateStatus(queue);
    moderation.notifyQueueAmount(queue);
}

async function initialize() {
    //console.log("IS THE ENVIRONMENT SPECIFIED:");
    //console.log(process.env.TEST);
    await moderation.initialize({
        token: process.env.DISCORD_TOKEN,
        channelId: process.env.DISCORD_CHANNEL_ID,
        moderatorRoleId: process.env.DISCORD_MODERATOR_ROLE_ID,
        ownerUserId: process.env.DISCORD_OWNER_USER_ID.includes(",") ?
            process.env.DISCORD_OWNER_USER_ID.split(",") :
            process.env.DISCORD_OWNER_USER_ID,
        trustedOptInRoleId: process.env.DISCORD_TRUSTED_OPTIN_ROLE_ID
    });
    
    await bot.initialize({
        /*twitter: {
            appKey: process.env.TWITTER_CONSUMER_KEY,
            appSecret: process.env.TWITTER_CONSUMER_SECRET,
            accessToken: process.env.TWITTER_ACCESS_TOKEN,
            accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
        },
        
        mastodon: {
            url: process.env.MASTODON_URL,
            accessToken: process.env.MASTODON_ACCESS_TOKEN
        },
        
        tumblr: {
            consumerKey: process.env.TUMBLR_CONSUMER_KEY,
            consumerSecret: process.env.TUMBLR_CONSUMER_SECRET,
            accessToken: process.env.TUMBLR_TOKEN,
            accessTokenSecret: process.env.TUMBLR_TOKEN_SECRET
        },
        
        bluesky: {
            service: process.env.BLUESKY_SERVICE,
            identifier: process.env.BLUESKY_IDENTIFIER,
            password: process.env.BLUESKY_PASSWORD
        },*/
        
        cohost: {
            email: process.env.COHOST_EMAIL,
            password: process.env.COHOST_PASSWORD,
            handle: process.env.COHOST_HANDLE
        }
    });
    
    // Hourly
    schedule.scheduleJob("0 * * * *", async () => {
        await run();
    });
    
    // Daily (at 0:00)
    schedule.scheduleJob("0 0 * * *", async () => {
        await bot.updateBio();
    });
    
    queue = JSON.parse(fs.readFileSync("./data/queue.json"));
    
    moderation.updateStatus(queue.length);
    await bot.updateBio();
}

function getQueue() {
    queue = JSON.parse(fs.readFileSync("./data/queue.json"));
    return queue;
}

function addPlatesToQueue(plates) {
    queue = plates.reverse().concat(queue);
    fs.writeFileSync("./data/queue.json", JSON.stringify(queue));
}

initialize();

export default { log, getQueue, addPlatesToQueue, run };