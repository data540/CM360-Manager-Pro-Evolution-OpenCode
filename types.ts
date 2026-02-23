
export type Status = 'Active' | 'Paused' | 'Draft' | 'Completed';

export interface Advertiser {
  id: string;
  name: string;
}

export interface Campaign {
  id: string;
  advertiserId: string;
  name: string;
  status: Status;
  startDate: string;
  endDate: string;
  budget: number;
  objective: string;
  updatedAt: string;
  isEuPolitical?: boolean;
  landingPageUrl?: string;
}

export interface Site {
  id: string;
  name: string;
  url: string;
}

export interface Placement {
  id: string;
  campaignId: string;
  name: string;
  siteId: string;
  size: string;
  type: 'Display' | 'Video' | 'Native';
  compatibility: 'DISPLAY' | 'DISPLAY_INTERSTITIAL' | 'IN_STREAM_VIDEO' | 'IN_STREAM_AUDIO';
  status: Status;
  startDate: string;
  endDate: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  externalUrl?: string;
}

export interface Creative {
  id: string;
  name: string;
  type: string;
  size: string;
  status: Status;
  thumbnailUrl: string;
  placementIds: string[];
  externalUrl?: string;
}

export interface BatchItem {
  id: string;
  name: string;
  siteId: string;
  size: string;
  startDate: string;
  endDate: string;
  errors: string[];
}

export type ViewType = 'Campaigns' | 'Placements' | 'Creatives' | 'AIHelper' | 'Settings';
