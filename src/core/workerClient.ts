/**
 * Worker Client
 * 
 * Abstraction for communicating with nexus-core workers.
 * Supports both API-based and queue-based communication.
 */

import type { CoreLogger, EventEnvelope } from "./types.ts";

export interface WorkerClient {
  healthCheck(): Promise<boolean>;
  registerWorker(workerId: string, namespace: string): Promise<void>;
  routeEvent(envelope: EventEnvelope): Promise<string[]>;
  subscribe(eventType: string): Promise<void>;
  unsubscribe(eventType: string): Promise<void>;
  getQueuesForWorker(): Promise<string[]>;
  disconnect(): Promise<void>;
}

/**
 * API-based worker client (HTTP/gRPC)
 */
export class ApiWorkerClient implements WorkerClient {
  constructor(
    private readonly apiEndpoint: string,
    private readonly logger: CoreLogger
  ) {}

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiEndpoint}/health`, {
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      return response.ok;
    } catch (error) {
      this.logger.debug("Worker health check failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async registerWorker(workerId: string, namespace: string): Promise<void> {
    const response = await fetch(`${this.apiEndpoint}/api/v1/workers/${workerId}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace, capabilities: [] })
    });

    if (!response.ok) {
      throw new Error(`Failed to register worker: ${response.statusText}`);
    }

    this.logger.info("Worker registered with nexus-core", { workerId, namespace });
  }

  async routeEvent(envelope: EventEnvelope): Promise<string[]> {
    const response = await fetch(`${this.apiEndpoint}/api/v1/events/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope)
    });

    if (!response.ok) {
      throw new Error(`Failed to route event: ${response.statusText}`);
    }

    const data = await response.json() as { routedQueues: string[] };
    return data.routedQueues;
  }

  async subscribe(eventType: string): Promise<void> {
    // Get worker ID from somewhere (would need to be passed in)
    // For now, this is a placeholder
    this.logger.debug("Subscribing to event type", { eventType });
  }

  async unsubscribe(eventType: string): Promise<void> {
    this.logger.debug("Unsubscribing from event type", { eventType });
  }

  async getQueuesForWorker(): Promise<string[]> {
    // Placeholder - would need worker ID
    return [];
  }

  async disconnect(): Promise<void> {
    // Cleanup if needed
  }
}

/**
 * Factory function to create appropriate worker client
 */
export function createWorkerClient(
  apiEndpoint: string | undefined,
  logger: CoreLogger
): WorkerClient | undefined {
  if (!apiEndpoint) {
    return undefined;
  }
  return new ApiWorkerClient(apiEndpoint, logger);
}

