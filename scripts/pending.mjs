// Placeholder for a `pnpm check` stage whose tooling lands in a later ticket.
// It exits 0 so the pipeline shape is real from day one; the ticket that owns
// the stage replaces the script entry in package.json with the real command.
const [, , stage = 'stage', ticket = 'a later ticket'] = process.argv;
console.log(`${stage}: not implemented yet — lands in ${ticket}`);
