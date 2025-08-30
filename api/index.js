const { MongoClient } = require('mongodb');
const webPush = require('web-push');

webPush.setVapidDetails(
    'mailto:josh@example.com', // Replace with your email
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

let client;
let db;

async function connectToMongo() {
    if (!client) {
        try {
            client = new MongoClient(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
            await client.connect();
            db = client.db('subscriptions');
            console.log('Connected to MongoDB');
        } catch (error) {
            console.error('MongoDB connection error:', error);
            throw error;
        }
    }
    return db;
}

module.exports = async (req, res) => {
    try {
        const db = await connectToMongo();
        const subscriptionsCollection = db.collection('subscriptions');
        const pushSubscriptionsCollection = db.collection('push_subscriptions');

        if (req.method === 'GET' && req.path === '/api/subscriptions') {
            const subscriptions = await subscriptionsCollection.find({}).toArray();
            res.status(200).json(subscriptions);
        } else if (req.method === 'POST' && req.path === '/api/subscriptions') {
            const newSub = req.body;
            newSub.createdAt = new Date();
            const result = await subscriptionsCollection.insertOne(newSub);
            await pushSubscriptionsCollection.find().forEach(sub => {
                webPush.sendNotification(sub, JSON.stringify({
                    title: 'Subscription Added 🎉',
                    body: `Your ${newSub.name} subscription for ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(newSub.cost)} has been added!`
                })).catch(error => console.error('Push notification error:', error));
            });
            res.status(201).json({ _id: result.insertedId, ...newSub });
        } else if (req.method === 'PUT' && req.path.includes('/toggle')) {
            const id = req.path.split('/').pop();
            const sub = await subscriptionsCollection.findOne({ _id: id });
            const newStatus = sub.status === 'Due' ? 'Paid' : 'Due';
            await subscriptionsCollection.updateOne({ _id: id }, { $set: { status: newStatus } });
            const message = newStatus === 'Paid' ? {
                title: 'Subscription Paid ✅',
                body: `Your ${sub.name} subscription for ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(sub.cost)} has been paid!`
            } : {
                title: 'Subscription Marked Due ⏰',
                body: `Your ${sub.name} subscription for ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(sub.cost)} is now due.`
            };
            await pushSubscriptionsCollection.find().forEach(sub => {
                webPush.sendNotification(sub, JSON.stringify(message)).catch(error => console.error('Push notification error:', error));
            });
            res.status(200).json({ success: true });
        } else if (req.method === 'PUT' && req.path.includes('/subscriptions/')) {
            const id = req.path.split('/').pop();
            const prevSub = await subscriptionsCollection.findOne({ _id: id });
            const updatedSub = req.body;
            await subscriptionsCollection.updateOne({ _id: id }, { $set: updatedSub });
            if (prevSub.cost !== updatedSub.cost) {
                await pushSubscriptionsCollection.find().forEach(sub => {
                    webPush.sendNotification(sub, JSON.stringify({
                        title: 'Subscription Increased 📈',
                        body: `Your ${updatedSub.name} subscription has increased to ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(updatedSub.cost)}.`
                    })).catch(error => console.error('Push notification error:', error));
                });
            }
            res.status(200).json({ success: true });
        } else if (req.method === 'DELETE' && req.path.includes('/subscriptions/')) {
            const id = req.path.split('/').pop();
            const sub = await subscriptionsCollection.findOne({ _id: id });
            await subscriptionsCollection.deleteOne({ _id: id });
            await pushSubscriptionsCollection.find().forEach(sub => {
                webPush.sendNotification(sub, JSON.stringify({
                    title: 'Subscription Deleted 🗑️',
                    body: `Your ${sub.name} subscription for ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(sub.cost)} has been deleted.`
                })).catch(error => console.error('Push notification error:', error));
            });
            res.status(200).json({ success: true });
        } else if (req.method === 'POST' && req.path === '/api/subscribe') {
            const subscription = req.body;
            await pushSubscriptionsCollection.updateOne(
                { endpoint: subscription.endpoint },
                { $set: subscription },
                { upsert: true }
            );
            res.status(201).json({ success: true });
        } else if (req.method === 'GET' && req.path === '/api/check-due') {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const dueSoonDate = new Date(today);
            dueSoonDate.setDate(today.getDate() + 7);
            const dueSubscriptions = await subscriptionsCollection.find({
                status: 'Due',
                dueDate: { $lte: dueSoonDate.toISOString().split('T')[0] }
            }).toArray();
            for (const sub of dueSubscriptions) {
                const dueDate = new Date(sub.dueDate);
                const message = dueDate < today ? {
                    title: 'Subscription Overdue ⚠️',
                    body: `Your ${sub.name} subscription for ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(sub.cost)} is overdue.`
                } : {
                    title: 'Subscription Due Soon ⏰',
                    body: `Your ${sub.name} subscription for ${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(sub.cost)} is due in ${Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24))} days.`
                };
                await pushSubscriptionsCollection.find().forEach(pushSub => {
                    webPush.sendNotification(pushSub, JSON.stringify(message)).catch(error => console.error('Push notification error:', error));
                });
            }
            res.status(200).json(dueSubscriptions);
        } else {
            res.status(404).json({ error: 'Not found' });
        }
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
