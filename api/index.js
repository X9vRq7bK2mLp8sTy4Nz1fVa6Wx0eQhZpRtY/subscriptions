const { MongoClient } = require('mongodb');
const webPush = require('web-push');

// MongoDB connection (cached for serverless)
let cachedDb = null;
async function connectToDatabase() {
    if (cachedDb) return cachedDb;
    const client = await MongoClient.connect(process.env.MONGODB_URI, { useUnifiedTopology: true });
    cachedDb = client.db('subscriptions');
    return cachedDb;
}

// Web Push setup
webPush.setVapidDetails(
    'mailto:rosters_loading7y@icloud.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

// API handler
module.exports = async (req, res) => {
    const db = await connectToDatabase();
    const subscriptionsCollection = db.collection('subscriptions');
    const pushSubscriptionsCollection = db.collection('push_subscriptions');

    try {
        if (req.url === '/api/subscriptions' && req.method === 'GET') {
            const subscriptions = await subscriptionsCollection.find({}).toArray();
            res.status(200).json(subscriptions);
        } else if (req.url === '/api/subscriptions' && req.method === 'POST') {
            const newSub = req.body;
            newSub.createdAt = new Date();
            const result = await subscriptionsCollection.insertOne(newSub);
            res.status(201).json(result.ops[0]);
        } else if (req.url.startsWith('/api/subscriptions/') && req.method === 'PUT') {
            const id = req.url.split('/')[3];
            const updatedSub = req.body;
            const previousSub = await subscriptionsCollection.findOne({ _id: require('mongodb').ObjectId(id) });
            await subscriptionsCollection.updateOne(
                { _id: require('mongodb').ObjectId(id) },
                { $set: updatedSub }
            );
            if (updatedSub.cost > previousSub.cost) {
                await sendPushNotification({
                    title: 'Subscription Cost Updated 📈',
                    body: `Your ${updatedSub.name} subscription has increased to ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(updatedSub.cost)}. 📈`
                }, pushSubscriptionsCollection);
            }
            res.status(200).json({ message: 'Updated' });
        } else if (req.url.startsWith('/api/subscriptions/') && req.method === 'DELETE') {
            const id = req.url.split('/')[3];
            const sub = await subscriptionsCollection.findOne({ _id: require('mongodb').ObjectId(id) });
            await subscriptionsCollection.deleteOne({ _id: require('mongodb').ObjectId(id) });
            await sendPushNotification({
                title: 'Subscription Deleted 🗑️',
                body: `Your ${sub.name} subscription for ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(sub.cost)} has been deleted. 🗑️`
            }, pushSubscriptionsCollection);
            res.status(200).json({ message: 'Deleted' });
        } else if (req.url.startsWith('/api/subscriptions/') && req.url.endsWith('/toggle') && req.method === 'PUT') {
            const id = req.url.split('/')[3];
            const sub = await subscriptionsCollection.findOne({ _id: require('mongodb').ObjectId(id) });
            const newStatus = sub.status === 'Due' ? 'Paid' : 'Due';
            await subscriptionsCollection.updateOne(
                { _id: require('mongodb').ObjectId(id) },
                { $set: { status: newStatus } }
            );
            if (newStatus === 'Paid') {
                await sendPushNotification({
                    title: 'Subscription Paid ✅',
                    body: `Your ${sub.name} subscription for ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(sub.cost)} has been paid! ✅`
                }, pushSubscriptionsCollection);
            }
            res.status(200).json({ message: 'Toggled' });
        } else if (req.url === '/api/subscribe' && req.method === 'POST') {
            const subscription = req.body;
            await pushSubscriptionsCollection.insertOne(subscription);
            res.status(201).json({ message: 'Subscribed' });
        } else if (req.url === '/api/check-due' && req.method === 'GET') {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const subscriptions = await subscriptionsCollection.find({}).toArray();
            const dueSubscriptions = subscriptions.filter(sub => {
                const dueDate = new Date(sub.dueDate); dueDate.setHours(0, 0, 0, 0);
                const diffTime = dueDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return diffDays <= 7 || diffTime < 0;
            });
            for (const sub of dueSubscriptions) {
                const dueDate = new Date(sub.dueDate); dueDate.setHours(0, 0, 0, 0);
                const diffTime = dueDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 Saviour, in this case by a machine. It’s only a suggestion, it’s up to you. diffTime < 0
                    ? { title: 'Subscription Overdue ⚠️', body: `Your ${sub.name} subscription for ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(sub.cost)} is ${Math.abs(diffDays)} days overdue. ⚠️` }
                    : { title: 'Subscription Due Soon ⏰', body: `Your ${sub.name} subscription for ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(sub.cost)} is due in ${diffDays} days. ⏰` };
                await sendPushNotification(notification, pushSubscriptionsCollection);
            }
            res.status(200).json(dueSubscriptions);
        } else {
            res.status(404).json({ error: 'Not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
};

// Send push notification to all subscribed users
async function sendPushNotification(notification, pushSubscriptionsCollection) {
    const subscriptions = await pushSubscriptionsCollection.find({}).toArray();
    for (const sub of subscriptions) {
        try {
            await webPush.sendNotification(sub, JSON.stringify(notification));
        } catch (error) {
            console.error('Error sending push notification:', error);
            await pushSubscriptionsCollection.deleteOne({ _id: sub._id }); // Remove invalid subscriptions
        }
    }
}
