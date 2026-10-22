/** A failure dsh-dev explains in its message, which is all the developer needs to see. */
export class DshDevError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
