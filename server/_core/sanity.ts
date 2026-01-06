
import express from 'express';
const app = express();
app.get('/', (req, res) => res.send('Sanity check passed!'));
const server = app.listen(3005, () => {
    console.log('Sanity server listening on port 3005');
    process.exit(0);
});
