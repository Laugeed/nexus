self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'NEXUS';
  const options = {
    body: data.body || 'Новое сообщение',
    icon: data.icon || '/icon.png',
    badge: '/icon.png',
    vibrate: [200, 100, 200],
    tag: 'nexus-message',
    renotify: true,
    data: { url: self.location.origin }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client)
          return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
