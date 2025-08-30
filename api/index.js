const { MongoClient, ObjectId } = require('mongodb');
const webPush = require('web-push');

// Make sure your Vercel environment variables are set for these
webPush.setVapidDetails(
    'mailto:rosters_loading7y@icloud.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

let db;

async function connectToMongo() {
    if (db) return db;
    try {
        const client = new MongoClient(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
        db = client.db('subscriptions'); // You can name your database here
        console.log('Connected to MongoDB');
        return db;
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
}

module.exports = async (req, res) => {
    try {
        const db = await connectToMongo();
        const subscriptionsCollection = db.collection('subscriptions');
        const pushSubscriptionsCollection = db.collection('push_subscriptions');

        const url = new URL(req.url, `http://${req.headers.host}`);
        const path = url.pathname;

        if (req.method === 'GET' && path === '/api/subscriptions') {
            const subscriptions = await subscriptionsCollection.find({}).sort({ dueDate: 1 }).toArray();
            res.status(200).json(subscriptions);
        } else if (req.method === 'POST' && path === '/api/subscriptions') {
            const newSub = req.body;
            if (!newSub.name || !newSub.cost) {
                return res.status(400).json({ error: 'Missing required fields' });
            }
            newSub.createdAt = new Date();
            const result = await subscriptionsCollection.insertOne(newSub);

            // Send push notification
            const notificationPayload = JSON.stringify({
                title: 'Subscription Added 🎉',
                body: `Your ${newSub.name} subscription for ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(newSub.cost)} has been added!`
            });
            const pushSubscriptions = await pushSubscriptionsCollection.find().toArray();
            for (const sub of pushSubscriptions) {
                webPush.sendNotification(sub, notificationPayload).catch(error => console.error(`Push notification error for ${sub.endpoint}:`, error.body || error));
            }

            res.status(201).json({ _id: result.insertedId, ...newSub });
        } else if (req.method === 'PUT' && path.startsWith('/api/subscriptions/') && path.endsWith('/toggle')) {
            const id = path.split('/')[3];
            const sub = await subscriptionsCollection.findOne({ _id: new ObjectId(id) });
            if (!sub) return res.status(404).json({ error: 'Subscription not found' });

            const newStatus = sub.status === 'Due' ? 'Paid' : 'Due';
            await subscriptionsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: newStatus } });

            // Send push notification logic follows...
            res.status(200).json({ success: true, newStatus });
        } else if (req.method === 'PUT' && path.startsWith('/api/subscriptions/')) {
            const id = path.split('/').pop();
            const updatedSub = req.body;
            await subscriptionsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedSub });
            res.status(200).json({ success: true });
        } else if (req.method === 'DELETE' && path.startsWith('/api/subscriptions/')) {
            const id = path.split('/').pop();

            // ✅ FIX: Fetch the subscription details *before* deleting it.
            const subToDelete = await subscriptionsCollection.findOne({ _id: new ObjectId(id) });
            if (!subToDelete) return res.status(404).json({ error: 'Subscription not found' });
            
            await subscriptionsCollection.deleteOne({ _id: new ObjectId(id) });

            // Now use `subToDelete` for the notification payload.
            const notificationPayload = JSON.stringify({
                title: 'Subscription Deleted 🗑️',
                body: `Your ${subToDelete.name} subscription for ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(subToDelete.cost)} has been deleted.`
            });
            const pushSubscriptions = await pushSubscriptionsCollection.find().toArray();
            for (const sub of pushSubscriptions) {
                 webPush.sendNotification(sub, notificationPayload).catch(error => console.error(`Push notification error for ${sub.endpoint}:`, error.body || error));
            }
            
            res.status(200).json({ success: true });
        } else if (req.method === 'POST' && path === '/api/subscribe') {
            const subscription = req.body;
            await pushSubscriptionsCollection.updateOne(
                { endpoint: subscription.endpoint },
                { $set: subscription },
                { upsert: true }
            );
            res.status(201).json({ success: true });
        } else if (req.method === 'GET' && path === '/api/check-due') {
            // This endpoint can be triggered by a cron job for daily checks
            // For now, it's called on page load by the client
            res.status(200).json({ message: 'Due check initiated by client.' });
        } else {
            res.status(404).json({ error: 'Route not found' });
        }
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
