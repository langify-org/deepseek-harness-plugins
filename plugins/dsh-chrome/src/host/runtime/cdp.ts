import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';
import type { ConnectorCdpEvent, ConnectorCdpMethod } from '../../protocol/connector.ts';

/**
 * Types of the Chrome DevTools Protocol, from the `devtools-protocol` package, narrowed
 * to what the connector allows. They describe what Chrome sends and accepts; the plugin
 * does not re-validate CDP results.
 */
export type CdpCommand = ConnectorCdpMethod;
export type CdpResult<M extends CdpCommand> = ProtocolMapping.Commands[M]['returnType'];
export type CdpEventName = ConnectorCdpEvent;
export type CdpEventParams<E extends CdpEventName> = ProtocolMapping.Events[E];

type CdpParams<M extends CdpCommand> = ProtocolMapping.Commands[M]['paramsType'];

/**
 * The arguments after a command's name: its parameters (required exactly when CDP
 * requires them), then options of type `O`.
 */
export type CdpArgs<M extends CdpCommand, O> =
  CdpParams<M> extends []
    ? [params?: undefined, options?: O]
    : CdpParams<M> extends [infer P]
      ? [params: P, options?: O]
      : [params?: NonNullable<CdpParams<M>[0]>, options?: O];

export type { Protocol } from 'devtools-protocol';
