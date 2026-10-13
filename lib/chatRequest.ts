export type ChatRequestTicket = { id: number; signal: AbortSignal };

/** Keeps a request bound to its original conversation, even across async saves. */
export class ChatRequestGate {
  private version = 0;
  private active: { ticket: ChatRequestTicket; controller: AbortController } | null = null;

  begin(): ChatRequestTicket | null {
    if (this.active) return null;
    const controller = new AbortController();
    const ticket = { id: ++this.version, signal: controller.signal };
    this.active = { ticket, controller };
    return ticket;
  }

  isCurrent(ticket: ChatRequestTicket): boolean {
    return this.active?.ticket === ticket && !ticket.signal.aborted;
  }

  finish(ticket: ChatRequestTicket): boolean {
    if (this.active?.ticket !== ticket) return false;
    this.active = null;
    return true;
  }

  cancel(): void {
    this.active?.controller.abort();
    this.active = null;
    this.version++;
  }
}
