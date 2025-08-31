self.addEventListener('push', event => {
    const data = event.data.json();
    self.registration.showNotification(data.title, {
        body: data.body
        // icon: '/icon.png' // Uncomment if icon.png exists in public folder
    });
});
