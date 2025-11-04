export interface RouterOSLease {
    '=.id': string;
    '=address': string;
    '=mac-address': string;
    '=client-id': string;
    '=address-lists': string;
    '=server': string;
    '=lease-time': string;
    '=dhcp-option': string;
    '=status': string;
    '=expires-after': string;
    '=last-seen': string;
    '=age': string;
    '=active-address': string;
    '=active-mac-address': string;
    '=active-client-id': string;
    '=active-server': string;
    '=host-name': string;
    '=radius': boolean;
    '=dynamic': boolean;
    '=blocked': boolean;
    '=disabled': boolean;
}

export interface RouterOSQueue {
    '=.id': string;
    '=name': string;
    '=target': string;
    '=parent': string;
    '=packet-marks': string;
    '=priority': string;
    '=queue': string;
    '=limit-at': string;
    '=max-limit': string;
    '=burst-limit': string;
    '=burst-threshold': string;
    '=burst-time': string;
    '=bucket-size': string;
    '=bytes': string;
    '=total-bytes': string;
    '=packets': string;
    '=total-packets': string;
    '=dropped': string;
    '=total-dropped': string;
    '=rate': string;
    '=total-rate': string;
    '=packet-rate': string;
    '=total-packet-rate': string;
    '=queued-packets': string;
    '=total-queued-packets': string;
    '=queued-bytes': string;
    '=total-queued-bytes': string;
    '=invalid': string;
    '=dynamic': string;
    '=disabled': string;
  }
