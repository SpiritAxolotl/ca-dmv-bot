import fs from "fs-extra"
import schedule from "node-schedule"

import bot from "./bot.js"
import moderation from "./moderation.js"

let queue = [];

async function run() {
    while (queue.length == 0) {
        addPlatesToQueue(await moderation.process())
    }
    
    await bot.post(queue.pop())
    fs.writeFileSync("./data/queue.json", JSON.stringify(queue))
    
    moderation.updateStatus(queue.length)
    await moderation.notifyQueueAmount(queue.length)
}

async function initialize() {
    await moderation.initialize({
        token: process.env.DISCORD_TOKEN,
        channelId: process.env.DISCORD_CHANNEL_ID,
        moderatorRoleId: process.env.DISCORD_MODERATOR_ROLE_ID,
        ownerUserId: process.env.DISCORD_OWNER_USER_ID
    })
    
    await bot.initialize({
        twitter: {
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
        },
        
        cohost: {
            service: process.env.COHOST_EMAIL,
            password: process.env.COHOST_PASSWORD_HASH
        }
    })

    // Hourly
    schedule.scheduleJob("0 * * * *", async () => {
        await run()
    })

    // Daily (at 0:00)
    schedule.scheduleJob("0 0 * * *", async () => {
        await bot.updateBio()
    })

    queue = JSON.parse(fs.readFileSync("./data/queue.json"))
    
    moderation.updateStatus(queue.length)
    await bot.updateBio()
}

function getQueue() {
    return queue
}

function addPlatesToQueue(plates) {
    queue = plates.reverse().concat(queue)
    fs.writeFileSync("./data/queue.json", JSON.stringify(queue))
}

initialize()

export default { getQueue, addPlatesToQueue }