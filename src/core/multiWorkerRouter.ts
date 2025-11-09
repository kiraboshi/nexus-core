/**
 * Multi-Worker Event Router
 * 
 * Routes events to queues based on event type and worker subscriptions.
 * Supports fan-out across multiple workers by using separate queues per event type.
 */

import type { CoreDatabase, CoreLogger, EventEnvelope } from "./types.ts";
import { sanitizeIdentifier } from "./utils.ts";

export interface WorkerSubscription {
  workerId: string;
  eventTypes: string[];
  subscribedAt: string;
}

export interface RouteConfig {
  eventType: string;
  workerQueues: Map<string, string>; // workerId -> queueName
  workerIds: string[];
}

export class MultiWorkerRouter {
  private routes: Map<string, RouteConfig> = new Map();
  private workerSubscriptions: Map<string, Set<string>> = new Map(); // workerId -> Set<eventType>

  constructor(
    private readonly db: CoreDatabase,
    private readonly logger: CoreLogger,
    private readonly namespace: string
  ) {}

  /**
   * Register a worker's subscription to event types
   */
  async subscribeWorker(workerId: string, eventTypes: string[]): Promise<void> {
    const existing = this.workerSubscriptions.get(workerId) ?? new Set();
    for (const eventType of eventTypes) {
      existing.add(eventType);
      
      // Get or create route for this event type
      let route = this.routes.get(eventType);
      if (!route) {
        route = {
          eventType,
          workerQueues: new Map(),
          workerIds: []
        };
        this.routes.set(eventType, route);
      }
      
      // Create queue for this worker+eventType combination
      if (!route.workerQueues.has(workerId)) {
        const queueName = this.getQueueNameForEventType(eventType, workerId);
        route.workerQueues.set(workerId, queueName);
        route.workerIds.push(workerId);
        
        // Ensure queue exists
        await this.ensureQueue(queueName);
      }
    }
    
    this.workerSubscriptions.set(workerId, existing);
    this.logger.info("Worker subscribed to event types", {
      workerId,
      eventTypes,
      totalRoutes: this.routes.size
    });
  }

  /**
   * Unsubscribe a worker from event types
   */
  async unsubscribeWorker(workerId: string, eventTypes: string[]): Promise<void> {
    const existing = this.workerSubscriptions.get(workerId);
    if (!existing) return;

    for (const eventType of eventTypes) {
      existing.delete(eventType);
      const route = this.routes.get(eventType);
      if (route) {
        route.workerIds = route.workerIds.filter(id => id !== workerId);
        if (route.workerIds.length === 0) {
          this.routes.delete(eventType);
          this.logger.info("Removed route (no workers)", { eventType });
        }
      }
    }

    if (existing.size === 0) {
      this.workerSubscriptions.delete(workerId);
    }
  }

  /**
   * Route an event to appropriate queue(s)
   * Returns queue names the event was routed to
   * 
   * For fan-out: Sends message to queue for EACH worker that handles this event type
   */
  async routeEvent(envelope: EventEnvelope): Promise<string[]> {
    const routedQueues: string[] = [];

    if (envelope.broadcast) {
      // Broadcast: send to ALL worker queues for ALL event types
      for (const route of this.routes.values()) {
        for (const [workerId, queueName] of route.workerQueues.entries()) {
          await this.sendToQueue(queueName, envelope);
          routedQueues.push(queueName);
        }
      }
      
      this.logger.info("Broadcast event routed to all worker queues", {
        eventType: envelope.eventType,
        queueCount: routedQueues.length
      });
    } else {
      // Normal: send to queue for EACH worker that handles this event type
      const route = this.routes.get(envelope.eventType);
      if (route) {
        for (const [workerId, queueName] of route.workerQueues.entries()) {
          await this.sendToQueue(queueName, envelope);
          routedQueues.push(queueName);
        }
        this.logger.debug("Event routed to worker queues", {
          eventType: envelope.eventType,
          queueCount: routedQueues.length,
          workerCount: route.workerIds.length
        });
      } else {
        // No route found - use default queue (fallback)
        const defaultQueue = this.getDefaultQueueName();
        await this.sendToQueue(defaultQueue, envelope);
        routedQueues.push(defaultQueue);
        this.logger.warn("No route found, using default queue", {
          eventType: envelope.eventType,
          defaultQueue
        });
      }
    }

    return routedQueues;
  }

  /**
   * Get queue names a worker should consume from
   * Returns queues that match this worker's ID
   */
  getQueuesForWorker(workerId: string): string[] {
    const subscriptions = this.workerSubscriptions.get(workerId);
    if (!subscriptions) return [];

    const queues: string[] = [];
    for (const eventType of subscriptions) {
      const route = this.routes.get(eventType);
      if (route) {
        const queueName = route.workerQueues.get(workerId);
        if (queueName) {
          queues.push(queueName);
        }
      }
    }
    return queues;
  }

  /**
   * Get all routes
   */
  getAllRoutes(): RouteConfig[] {
    return Array.from(this.routes.values());
  }

  private getQueueNameForEventType(eventType: string, workerId: string): string {
    // Sanitize event type for use in queue name
    const sanitized = sanitizeIdentifier(eventType.replace(/\./g, "_"));
    const sanitizedWorkerId = sanitizeIdentifier(workerId);
    return `core_events_${sanitizeIdentifier(this.namespace)}_${sanitizedWorkerId}_${sanitized}`;
  }

  private getDefaultQueueName(): string {
    return `core_events_${sanitizeIdentifier(this.namespace)}`;
  }

  private async ensureQueue(queueName: string): Promise<void> {
    try {
      await this.db.query(`SELECT pgmq.create($1::text)`, [queueName]);
      this.logger.debug("Created queue", { queueName });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes("already exists") && !errorMessage.includes("duplicate")) {
        this.logger.error("Failed to create queue", { queueName, error: errorMessage });
        throw error;
      }
    }
  }

  private async sendToQueue(queueName: string, envelope: EventEnvelope): Promise<void> {
    await this.db.query(`SELECT pgmq.send($1, $2::jsonb)`, [queueName, envelope]);
  }
}

