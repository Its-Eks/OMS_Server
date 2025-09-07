import { dbClient } from './main';

dbClient.connect()
    .then(() => {
        console.log('Connected to Postgres successfully!');
        return dbClient.query('SELECT NOW()');
    })
    .then((res: { rows: any[] }) => {
        console.log('Test query result:', res.rows[0]);
    })
    .catch((err: Error & { stack?: string }) => {
        console.error('Connection error:', err.stack);
    })
    .finally(() => {
        dbClient.end();
    });
