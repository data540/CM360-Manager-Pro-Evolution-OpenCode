
import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Ad, Creative, Site } from '../types';
import { CM360_ERROR_MAPPING, NAMING_TAXONOMY } from '../constants';
import { 
  Search, 
  Filter, 
  Grid, 
  List, 
  ExternalLink, 
  MoreVertical,
  Image as ImageIcon,
  FileCode,
  Video,
  RefreshCw,
  AlertCircle,
  Copy,
  Check,
  Plus,
  HelpCircle,
  ChevronDown as ChevronDownIcon,
  X as XIcon,
  Layers,
  LayoutDashboard,
  SearchCode,
  UploadCloud,
  Loader2
} from 'lucide-react';
import Toast from './Toast';
import CreativeBulkEditPanel from './CreativeBulkEditPanel';

const CreativeGrid: React.FC = () => {
  const { 
    creatives, 
    selectedAdvertiser, 
    selectedCampaign, 
    setSelectedAdvertiser,
    setSelectedCampaign,
    fetchCreatives, 
    connectionStatus, 
    uploadCreative, 
    accountId,
    profileId,
    accessToken,
    isGlobalSearchActive,
    setIsGlobalSearchActive,
    advertisers,
    fetchAllCreatives,
    copyCreative,
    campaigns,
    placements,
    ads,
    sites,
    fetchCampaigns,
    fetchPlacements,
    fetchSites,
    fetchAds,
    assignCreativeToPlacement,
    assignCreativeToAd,
    creativesDrafts,
    fetchLandingPages
  } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [loading, setLoading] = useState(false);
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isBulkEditPanelOpen, setIsBulkEditPanelOpen] = useState(false);
  const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);

  // Naming Convention States
  const [namingPrefix, setNamingPrefix] = useState('');
  const [namingSuffix, setNamingSuffix] = useState('');
  const [includeDate, setIncludeDate] = useState(true);
  
  // Modals States
  const [activeModal, setActiveModal] = useState<'advertiser' | 'campaign' | 'placement' | null>(null);
  const [creativeToAssign, setCreativeToAssign] = useState<Creative | null>(null);
  const [destAdvertiserId, setDestAdvertiserId] = useState('');
  const [destCampaignId, setDestCampaignId] = useState('');
  const [destPlacementId, setDestPlacementId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  
  // Batch Upload States
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number, status: string} | null>(null);
  
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [customName, setCustomName] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('Display');
  const [selectedSize, setSelectedSize] = useState('');
  const [selectedTech, setSelectedTech] = useState((NAMING_TAXONOMY.Tech[0] || 'dv360').toUpperCase());
  const [uploadAdId, setUploadAdId] = useState('');
  const [uploadAssignMode, setUploadAssignMode] = useState<'add' | 'replace'>('add');
  const [batchAssignmentMode, setBatchAssignmentMode] = useState<'auto' | 'single' | 'none'>('auto');
  const [batchPlans, setBatchPlans] = useState<Array<{
    file: File;
    finalSize: string;
    sizeFromName: string | null;
    sizeFromFile: string | null;
    mismatch: boolean;
    candidateAds: Ad[];
    selectedAdIds: string[];
    assignmentReason: string;
    manualConfirmed: boolean;
  }>>([]);
  const [manualPlanIndex, setManualPlanIndex] = useState<number | null>(null);
  const [applyManualSelectionToSameSize, setApplyManualSelectionToSameSize] = useState(true);
  const [isErrorGuideOpen, setIsErrorGuideOpen] = useState(false);

  // Sites multi-select (replaces the static "Tech" naming token for Batch Upload)
  const [selectedSiteIds, setSelectedSiteIds] = useState<Set<string> | null>(null);

  // Batch Upload Report (per-file detail shown after a batch run completes)
  type BatchReportRow = {
    fileName: string;
    size: string;
    siteNames: string;
    adName: string | null;
    status: 'assigned' | 'uploaded_only' | 'skipped' | 'assign_failed' | 'upload_failed';
    detail: string;
    link: string | null;
  };
  const [batchReport, setBatchReport] = useState<BatchReportRow[] | null>(null);
  const [listColumnWidths, setListColumnWidths] = useState({
    preview: 110,
    name: 420,
    type: 180,
    size: 170,
    status: 150,
  });

  const isDefaultAd = (ad: Ad) => /default/i.test(ad.name || '');

  const campaignAds = selectedCampaign
    ? ads.filter((ad) => ad.campaignId === selectedCampaign.id)
    : [];
  const selectableCampaignAds = campaignAds.filter((ad) => !isDefaultAd(ad));

  const campaignPlacements = selectedCampaign
    ? placements.filter((p) => p.campaignId === selectedCampaign.id)
    : [];
  const campaignSites: Site[] = (() => {
    const uniqueSiteIds = Array.from(new Set(campaignPlacements.map((p) => p.siteId).filter(Boolean)));
    return uniqueSiteIds
      .map((siteId) => sites.find((s) => s.id === siteId))
      .filter((s): s is Site => !!s);
  })();
  const effectiveSelectedSiteIds: Set<string> = selectedSiteIds ?? new Set(campaignSites.map((s) => s.id));

  const startListResize = (column: keyof typeof listColumnWidths, startX: number, startWidth: number) => {
    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startX;
      setListColumnWidths((prev) => ({
        ...prev,
        [column]: Math.max(100, Math.min(650, startWidth + delta)),
      }));
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  useEffect(() => {
    if (activeModal === 'campaign' && destAdvertiserId) {
      fetchCampaigns(destAdvertiserId);
    }
  }, [activeModal, destAdvertiserId, fetchCampaigns]);

  useEffect(() => {
    if (activeModal === 'placement' && destCampaignId) {
      fetchPlacements(destCampaignId);
    }
  }, [activeModal, destCampaignId, fetchPlacements]);
  
  const CREATIVE_SPECS: Record<string, string[]> = {
    'Display': ['970x250', '970x90', '728x90', '300x250', '160x600', '300x600', '300x1050', '468x60', '250x250', '200x200'],
    'Mobile Display': ['320x50', '300x50', '320x480', '480x320'],
    'Tracking': ['1x1'],
    'Rich Media': ['728x90', '300x250', '160x600', '300x600', 'Interstitial'],
    'Video': ['In-stream', 'Companion 300x250', 'Companion 728x90', 'Companion 300x60', 'Companion 160x600']
  };
  
  const CREATIVE_FORMATS = Object.keys(CREATIVE_SPECS);
  const TECH_OPTIONS = NAMING_TAXONOMY.Tech.map((tech) => tech.toUpperCase());
  
  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error' | 'loading', message: string, details?: string, link?: string}>({
    show: false,
    type: 'loading',
    message: ''
  });

  const normalizeSize = (value?: string | null): string | null => {
    if (!value) return null;
    const match = value.match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (!match) return null;
    return `${parseInt(match[1], 10)}x${parseInt(match[2], 10)}`;
  };

  const extractSizeFromName = (name: string): string | null => {
    const match = name.match(/(\d+)\s*[x×]\s*(\d+)(?:[_-]\d+)?/i);
    if (!match) return null;
    return `${parseInt(match[1], 10)}x${parseInt(match[2], 10)}`;
  };

  const collapseUnderscores = (value: string): string => value.replace(/_{2,}/g, '_');

  const toNameToken = (value?: string | null): string => (value || '').trim().replace(/\s+/g, '_');

  const joinNameTokens = (tokens: Array<string | null | undefined>): string => {
    return collapseUnderscores(tokens.map(toNameToken).filter(Boolean).join('_'));
  };

  const getImageSize = (file: File): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        resolve(null);
        return;
      }

      try {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const size = `${img.naturalWidth || img.width}x${img.naturalHeight || img.height}`;
          URL.revokeObjectURL(url);
          resolve(normalizeSize(size));
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      } catch {
        resolve(null);
      }
    });
  };

  const getAdsBySize = (): Map<string, Ad[]> => {
    const map = new Map<string, Ad[]>();
    campaignAds.forEach((ad) => {
      const uniqueSizes = new Set<string>();
      ad.placementIds.forEach((placementId) => {
        const placement = placements.find((p) => p.id === placementId);
        if (!placement) return;
        if (effectiveSelectedSiteIds.size > 0 && !effectiveSelectedSiteIds.has(placement.siteId)) return;
        const size = normalizeSize(placement.size || null);
        if (size) uniqueSizes.add(size);
      });

      uniqueSizes.forEach((size) => {
        if (!map.has(size)) map.set(size, []);
        map.get(size)!.push(ad);
      });
    });
    return map;
  };

  const resolveFileSize = async (file: File): Promise<{ sizeFromName: string | null; sizeFromFile: string | null; mismatch: boolean; finalSize: string }> => {
    const sizeFromName = normalizeSize(extractSizeFromName(file.name));
    const sizeFromFile = normalizeSize(await getImageSize(file));
    const mismatch = !!(sizeFromName && sizeFromFile && sizeFromName !== sizeFromFile);
    const finalSize = sizeFromFile || sizeFromName || normalizeSize(selectedSize) || '300x250';
    return { sizeFromName, sizeFromFile, mismatch, finalSize };
  };

  const resolveBatchPlans = async (files: File[]) => {
    const adsBySize = getAdsBySize();
    const plans: Array<{
      file: File;
      finalSize: string;
      sizeFromName: string | null;
      sizeFromFile: string | null;
      mismatch: boolean;
      candidateAds: Ad[];
      selectedAdIds: string[];
      assignmentReason: string;
      manualConfirmed: boolean;
    }> = [];

    for (const file of files) {
      const { sizeFromName, sizeFromFile, mismatch, finalSize } = await resolveFileSize(file);
      const adsForSize = adsBySize.get(finalSize) || [];
      const selectableCandidates = adsForSize.filter((ad) => !isDefaultAd(ad));

      let selectedAdIds: string[] = [];
      let assignmentReason = 'no_match';
      let manualConfirmed = true;

      if (selectableCandidates.length === 1) {
        selectedAdIds = [selectableCandidates[0].id];
        assignmentReason = 'auto_single_match';
      } else if (selectableCandidates.length > 1) {
        // Default to all matching Ads selected; the user narrows down in the review modal.
        selectedAdIds = selectableCandidates.map((ad) => ad.id);
        assignmentReason = 'manual_required';
        manualConfirmed = false;
      } else if (adsForSize.length > 0) {
        assignmentReason = 'default_only_unselectable';
      }

      plans.push({
        file,
        finalSize,
        sizeFromName,
        sizeFromFile,
        mismatch,
        candidateAds: adsForSize,
        selectedAdIds,
        assignmentReason,
        manualConfirmed,
      });
    }

    return plans;
  };

  const startBatchUpload = async (plansToRun?: typeof batchPlans) => {
    if (!selectedAdvertiser) return;

    const plans = plansToRun && plansToRun.length > 0 ? plansToRun : batchPlans;
    if (plans.length === 0) return;

    setIsUploadModalOpen(false);
    setManualPlanIndex(null);
    const dateToken = includeDate ? new Date().toLocaleDateString('es-ES').replace(/\//g, '-') : '';
    const siteNamesLabel = campaignSites
      .filter((s) => effectiveSelectedSiteIds.has(s.id))
      .map((s) => s.name)
      .join(', ') || 'N/A';

    setBatchProgress({ current: 0, total: plans.length, status: 'Starting batch upload...' });

    const reportRows: BatchReportRow[] = [];

    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      const baseName = plan.file.name.split('.')[0];
      const finalName = joinNameTokens([namingPrefix, baseName, namingSuffix, dateToken]);

      setBatchProgress({
        current: i + 1,
        total: plans.length,
        status: `Uploading ${plan.file.name} (${i + 1}/${plans.length})`
      });

      setToast({
        show: true,
        type: 'loading',
        message: `Batch Processing: ${i + 1}/${plans.length}`,
        details: `Uploading ${plan.file.name}...`
      });

      const result = await uploadCreative(plan.file, finalName, selectedFormat, plan.finalSize);
      if (!result.success) {
        reportRows.push({
          fileName: plan.file.name,
          size: plan.finalSize,
          siteNames: siteNamesLabel,
          adName: null,
          status: 'upload_failed',
          detail: result.error || 'Unknown upload error',
          link: null,
        });
        continue;
      }

      const creativeLink = result.id
        ? `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}/advertisers/${selectedAdvertiser.id}/creatives/${result.id}`
        : null;

      const adsToAssign = batchAssignmentMode === 'auto'
        ? plan.selectedAdIds
        : batchAssignmentMode === 'single'
          ? (uploadAdId ? [uploadAdId] : [])
          : [];

      if (adsToAssign.length > 0 && result.id) {
        const assignedNames: string[] = [];
        const failedNames: string[] = [];
        for (const adId of adsToAssign) {
          const targetAd = campaignAds.find((ad) => ad.id === adId);
          const assignResult = await assignCreativeToAd(result.id, adId, selectedCampaign?.id, uploadAssignMode);
          if (assignResult.success) {
            assignedNames.push(targetAd?.name || adId);
          } else {
            failedNames.push(`${targetAd?.name || adId} (${assignResult.error || 'Unknown error'})`);
          }
        }
        reportRows.push({
          fileName: plan.file.name,
          size: plan.finalSize,
          siteNames: siteNamesLabel,
          adName: assignedNames.join(', ') || null,
          status: failedNames.length === 0 ? 'assigned' : 'assign_failed',
          detail: failedNames.length === 0
            ? `Uploaded and assigned to: ${assignedNames.join(', ')}.`
            : `Assigned to ${assignedNames.length}/${adsToAssign.length} Ads. Failed: ${failedNames.join('; ')}`,
          link: creativeLink,
        });
      } else if (batchAssignmentMode === 'none') {
        reportRows.push({
          fileName: plan.file.name,
          size: plan.finalSize,
          siteNames: siteNamesLabel,
          adName: null,
          status: 'uploaded_only',
          detail: 'Uploaded without Ad assignment (Upload only mode).',
          link: creativeLink,
        });
      } else if (plan.assignmentReason === 'manual_skipped') {
        reportRows.push({
          fileName: plan.file.name,
          size: plan.finalSize,
          siteNames: siteNamesLabel,
          adName: null,
          status: 'skipped',
          detail: 'Ad assignment skipped by user during manual selection.',
          link: creativeLink,
        });
      } else {
        const detail = plan.assignmentReason === 'default_only_unselectable'
          ? `Only Default Ads matched size ${plan.finalSize}. Default Ads are not selectable.`
          : plan.assignmentReason === 'no_match'
            ? `No compatible Ad found for size ${plan.finalSize} among the selected Sites.`
            : 'No Ad was assigned for this file.';
        reportRows.push({
          fileName: plan.file.name,
          size: plan.finalSize,
          siteNames: siteNamesLabel,
          adName: null,
          status: 'assign_failed',
          detail,
          link: creativeLink,
        });
      }
    }

    setBatchProgress(null);
    setPendingFiles([]);
    setBatchPlans([]);
    setToast({ show: false, type: 'loading', message: '' });
    setBatchReport(reportRows);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, isBatch: boolean = false) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !selectedAdvertiser) return;

    setBatchPlans([]);
    setManualPlanIndex(null);
    setApplyManualSelectionToSameSize(true);
    setBatchReport(null);

    if (isBatch || files.length > 1) {
      setPendingFiles(files);
      setCustomName('Batch_Upload');
      setSelectedFormat('Display');
      setSelectedSize(CREATIVE_SPECS['Display'][0]);
      setNamingPrefix('');
      setNamingSuffix('');
      setSelectedSiteIds(null);
      setUploadAdId('');
      setUploadAssignMode('add');
      setBatchAssignmentMode('auto');
      setIsUploadModalOpen(true);
      if (selectedCampaign) {
        fetchPlacements(selectedCampaign.id);
        fetchSites();
      }
    } else {
      const file = files[0];
      setPendingFile(file);
      setPendingFiles([]);
      setCustomName(file.name.split('.')[0]);
      
      const initialFormat = file.type.startsWith('video/') ? 'Video' : 'Display';
      setSelectedFormat(initialFormat);
      setSelectedTech((NAMING_TAXONOMY.Tech[0] || 'dv360').toUpperCase());
      
      // Auto-detect image dimensions
      if (file.type.startsWith('image/')) {
        const img = new Image();
        img.onload = () => {
          const detectedSize = `${img.width}x${img.height}`;
          setSelectedSize(detectedSize);
          URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(file);
      } else {
        setSelectedSize(CREATIVE_SPECS[initialFormat][0]);
      }
      setUploadAdId('');
      setUploadAssignMode('add');
      
      setIsUploadModalOpen(true);
    }

    if (selectedCampaign) {
      fetchAds(selectedCampaign.id);
    }
    
    // Reset input so the same file can be selected again if needed
    e.target.value = '';
    setIsNewMenuOpen(false);
  };

  const confirmUpload = async () => {
    if ((!pendingFile && pendingFiles.length === 0) || !selectedAdvertiser) return;

    const isBatch = pendingFiles.length > 0;
    const assignmentRequiresCampaign = isBatch ? batchAssignmentMode !== 'none' : !!uploadAdId;

    if (assignmentRequiresCampaign && !selectedCampaign) {
      setToast({
        show: true,
        type: 'error',
        message: 'Campaign required',
        details: 'Select a campaign before assigning creatives to an Ad.'
      });
      return;
    }

    if (uploadAdId && !campaignAds.some((ad) => ad.id === uploadAdId)) {
      setToast({
        show: true,
        type: 'error',
        message: 'Invalid Ad selection',
        details: 'The selected Ad is not available for the active campaign. Refresh Ads and retry.'
      });
      return;
    }

    if (uploadAdId && campaignAds.some((ad) => ad.id === uploadAdId && isDefaultAd(ad))) {
      setToast({
        show: true,
        type: 'error',
        message: 'Default Ad cannot be selected',
        details: 'Default Ads are shown in gray and are not eligible for direct assignment. Choose another Ad.'
      });
      return;
    }

    if (uploadAdId && uploadAssignMode === 'replace') {
      const confirmed = window.confirm('Replace mode will overwrite current creative assignments in the selected Ad. Continue?');
      if (!confirmed) return;
    }

    if (isBatch && batchAssignmentMode === 'single' && !uploadAdId) {
      setToast({
        show: true,
        type: 'error',
        message: 'Ad required',
        details: 'Select a target Ad for "Assign all to one Ad" mode.'
      });
      return;
    }

    if (pendingFiles.length > 0) {
      if (batchAssignmentMode === 'auto') {
        const plans = await resolveBatchPlans(pendingFiles);
        setBatchPlans(plans);
        const firstManualIndex = plans.findIndex((plan) => !plan.manualConfirmed);

        if (firstManualIndex >= 0) {
          setManualPlanIndex(firstManualIndex);
          return;
        }

        await startBatchUpload(plans);
      } else if (batchAssignmentMode === 'single') {
        const plans = await Promise.all(pendingFiles.map(async (file) => {
          const { sizeFromName, sizeFromFile, mismatch, finalSize } = await resolveFileSize(file);
          return {
            file,
            finalSize,
            sizeFromName,
            sizeFromFile,
            mismatch,
            candidateAds: [],
            selectedAdIds: uploadAdId ? [uploadAdId] : [],
            assignmentReason: uploadAdId ? 'manual_selected_ad' : 'no_assignment',
            manualConfirmed: true,
          };
        }));
        await startBatchUpload(plans);
      } else {
        const plans = await Promise.all(pendingFiles.map(async (file) => {
          const { sizeFromName, sizeFromFile, mismatch, finalSize } = await resolveFileSize(file);
          return {
            file,
            finalSize,
            sizeFromName,
            sizeFromFile,
            mismatch,
            candidateAds: [],
            selectedAdIds: [],
            assignmentReason: 'no_assignment',
            manualConfirmed: true,
          };
        }));
        await startBatchUpload(plans);
      }
    } else if (pendingFile) {
      // Single Upload Logic
      setIsUploadModalOpen(false);
      const campaignToken = selectedCampaign ? selectedCampaign.name.substring(0, 10) : '';
      const techToken = (selectedTech || 'DV360').trim().toUpperCase();
      const finalName = joinNameTokens([
        campaignToken,
        customName,
        techToken,
        selectedFormat,
        selectedSize.replace(/\s+/g, '_')
      ]);

      setToast({
        show: true,
        type: 'loading',
        message: 'Uploading creative to CM360...',
        details: `Processing ${finalName} and registering asset.`
      });

      const result = await uploadCreative(pendingFile, finalName, selectedFormat, selectedSize);
      
      if (result.success) {
        let adAssignmentError = '';
        let adAssignmentSuccess = '';
        if (uploadAdId && result.id) {
          const assignResult = await assignCreativeToAd(result.id, uploadAdId, selectedCampaign?.id, uploadAssignMode);
          if (!assignResult.success) {
            adAssignmentError = assignResult.error || 'Could not assign creative to selected Ad';
          } else {
            const targetAd = campaignAds.find((ad) => ad.id === uploadAdId);
            adAssignmentSuccess = targetAd ? `Assigned to Ad: ${targetAd.name}.` : 'Assigned to selected Ad.';
          }
        }

        const baseUrl = `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}`;
        const creativePath = `/advertisers/${selectedAdvertiser.id}/creatives/${result.id}`;
        const verifyLink = `${baseUrl}${creativePath}`;
        
        setToast({
          show: true,
          type: adAssignmentError ? 'error' : 'success',
          message: adAssignmentError ? 'Upload succeeded, assignment failed' : 'Upload Successful!',
          details: adAssignmentError || `${adAssignmentSuccess} The creative has been registered and is now available in Campaign Manager.`,
          link: verifyLink
        });
      } else {
        const errorCode = result.error?.match(/\d+/)?.[0] || (result.error === 'Network error' ? 'Network error' : 'default');
        const mappedError = CM360_ERROR_MAPPING[errorCode] || CM360_ERROR_MAPPING['default'];

        setToast({
          show: true,
          type: 'error',
          message: mappedError.title,
          details: `${mappedError.description} (Original: ${result.error})`
        });
      }
      setPendingFile(null);
    }
  };

  const handleToggleManualAd = (adId: string) => {
    if (manualPlanIndex === null) return;
    setBatchPlans((prev) => prev.map((plan, idx) => {
      if (idx !== manualPlanIndex) return plan;
      const isSelected = plan.selectedAdIds.includes(adId);
      return {
        ...plan,
        selectedAdIds: isSelected
          ? plan.selectedAdIds.filter((id) => id !== adId)
          : [...plan.selectedAdIds, adId],
      };
    }));
  };

  const advanceManualFlow = (updatedPlans: typeof batchPlans) => {
    const nextManual = updatedPlans.findIndex((plan) => !plan.manualConfirmed);
    if (nextManual >= 0) {
      setManualPlanIndex(nextManual);
      return;
    }
    setManualPlanIndex(null);
    startBatchUpload(updatedPlans);
  };

  const handleManualConfirm = () => {
    if (manualPlanIndex === null) return;

    const currentPlan = batchPlans[manualPlanIndex];
    const confirmedAdIds = currentPlan.selectedAdIds;

    const updatedPlans = batchPlans.map((plan, idx) => {
      const shouldApplyToCurrent = idx === manualPlanIndex;
      const shouldApplyToSameSize = applyManualSelectionToSameSize
        && idx > manualPlanIndex
        && !plan.manualConfirmed
        && plan.finalSize === currentPlan.finalSize;

      if (!shouldApplyToCurrent && !shouldApplyToSameSize) return plan;

      return {
        ...plan,
        selectedAdIds: shouldApplyToCurrent
          ? confirmedAdIds
          : confirmedAdIds.filter((adId) => plan.candidateAds.some((ad) => ad.id === adId)),
        assignmentReason: confirmedAdIds.length === 0
          ? 'manual_skipped'
          : (shouldApplyToCurrent ? 'manual_selected_match' : 'manual_selected_match_by_size'),
        manualConfirmed: true,
      };
    });

    setBatchPlans(updatedPlans);
    advanceManualFlow(updatedPlans);
  };

  const handleManualSkipFile = () => {
    if (manualPlanIndex === null) return;

    const updatedPlans = batchPlans.map((plan, idx) => (
      idx === manualPlanIndex
        ? { ...plan, selectedAdIds: [], assignmentReason: 'manual_skipped', manualConfirmed: true }
        : plan
    ));

    setBatchPlans(updatedPlans);
    advanceManualFlow(updatedPlans);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRefresh = async () => {
    setLoading(true);
    if (isGlobalSearchActive) {
      await fetchAllCreatives();
    } else if (selectedAdvertiser) {
      await fetchCreatives();
    }
    setLoading(false);
  };

  const handleAssign = async () => {
    if (!creativeToAssign || !destAdvertiserId) return;
    setIsAssigning(true);
    setToast({
      show: true,
      type: 'loading',
      message: 'Copying creative...',
      details: `Assigning ${creativeToAssign.name} to new advertiser.`
    });

    const result = await copyCreative(creativeToAssign.id, destAdvertiserId);
    setIsAssigning(false);
    setActiveModal(null);

    if (result.success) {
      setToast({
        show: true,
        type: 'success',
        message: 'Creative Assigned!',
        details: 'The creative has been successfully copied to the destination advertiser.',
        link: `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}/advertisers/${destAdvertiserId}/creatives/${result.id}`
      });
    } else {
      setToast({
        show: true,
        type: 'error',
        message: 'Assignment Failed',
        details: result.error
      });
    }
  };

  const handleAssignToPlacement = async () => {
    if (!creativeToAssign || !destPlacementId || !destCampaignId) return;
    setIsAssigning(true);
    setToast({
      show: true,
      type: 'loading',
      message: 'Creating Ad...',
      details: `Linking ${creativeToAssign.name} to placement.`
    });

    const result = await assignCreativeToPlacement(creativeToAssign.id, destPlacementId, destCampaignId);
    setIsAssigning(false);
    setActiveModal(null);

    if (result.success) {
      setToast({
        show: true,
        type: 'success',
        message: 'Ad Created!',
        details: 'The creative has been linked to the placement via a new Ad.',
        link: `https://campaignmanager.google.com/trafficking/#/accounts/${accountId}/campaigns/${destCampaignId}/explorer/ads/${result.id}`
      });
    } else {
      setToast({
        show: true,
        type: 'error',
        message: 'Assignment Failed',
        details: result.error
      });
    }
  };

  useEffect(() => {
    if (isGlobalSearchActive && !selectedAdvertiser) {
      fetchAllCreatives();
    }
  }, [isGlobalSearchActive, selectedAdvertiser, fetchAllCreatives]);

  useEffect(() => {
    if (selectedAdvertiser && !isGlobalSearchActive) {
      fetchCreatives();
    }
  }, [selectedAdvertiser, isGlobalSearchActive, fetchCreatives]);

  useEffect(() => {
    if (selectedAdvertiser) {
      fetchLandingPages(selectedAdvertiser.id);
    }
  }, [selectedAdvertiser, fetchLandingPages]);

  const displayCreatives = creatives.map((c) => ({
    ...c,
    ...(creativesDrafts[c.id] || {}),
    isDraft: !!creativesDrafts[c.id],
  }));

  const filteredCreatives = displayCreatives.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase());
    // If global search is active, we ignore the campaign filter
    if (isGlobalSearchActive) return matchesSearch;
    
    const matchesCampaign = !selectedCampaign || c.name.toLowerCase().includes(selectedCampaign.name.substring(0, 5).toLowerCase());
    return matchesSearch && matchesCampaign;
  });

  const getIcon = (type: string) => {
    if (type.includes('HTML5') || type.includes('RICH_MEDIA')) return <FileCode className="w-5 h-5 text-amber-500" />;
    if (type.includes('VIDEO')) return <Video className="w-5 h-5 text-rose-500" />;
    return <ImageIcon className="w-5 h-5 text-blue-500" />;
  };

  const getScaledPreviewSize = (size: string, compact: boolean) => {
    const parsed = normalizeSize(size);
    const [rawWidth, rawHeight] = parsed ? parsed.split('x').map((value) => parseInt(value, 10)) : [300, 250];
    const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 300;
    const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 250;

    const maxWidth = compact ? 30 : 170;
    const maxHeight = compact ? 22 : 120;
    const minWidth = compact ? 8 : 24;
    const minHeight = compact ? 8 : 20;
    const scale = Math.min(maxWidth / width, maxHeight / height);

    return {
      width: Math.max(minWidth, Math.round(width * scale)),
      height: Math.max(minHeight, Math.round(height * scale)),
      label: `${width}x${height}`,
    };
  };

  const renderCreativePlaceholder = (creative: Creative, compact = false) => {
    const label = creative.type?.replace(/_/g, ' ') || 'CREATIVE';
    const previewSize = getScaledPreviewSize(creative.size, compact);

    return (
      <div className={`w-full h-full rounded-lg border border-blue-500/30 bg-gradient-to-br from-blue-600/20 via-slate-900 to-slate-950 flex flex-col items-center justify-center gap-2 ${compact ? 'px-2 py-1' : 'px-3 py-2'}`}>
        <div
          className="rounded-sm border border-blue-300/80 bg-blue-400/10 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]"
          style={{ width: `${previewSize.width}px`, height: `${previewSize.height}px` }}
        />
        <div className="text-center leading-tight">
          <p className={`font-bold uppercase tracking-wider text-blue-200 ${compact ? 'text-[8px]' : 'text-[10px]'}`}>{label}</p>
          <p className={`text-blue-400 font-mono ${compact ? 'text-[8px]' : 'text-[10px]'}`}>{previewSize.label}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="view-root flex-1 flex flex-col h-full bg-slate-950/40">
      {/* Toolbar */}
      <div className="view-toolbar p-4 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-900/50 backdrop-blur-sm relative z-20">
        <div className={`flex-1 max-w-md relative transition-all duration-300 ${isGlobalSearchActive ? 'ring-2 ring-blue-500/50 rounded-lg' : ''}`}>
          <Search className={`absolute left-3 top-2.5 w-4 h-4 ${isGlobalSearchActive ? 'text-blue-400' : 'text-slate-500'}`} />
          <input 
            type="text" 
            placeholder={isGlobalSearchActive ? "Searching in ALL advertiser creatives..." : "Search creatives in this advertiser..."}
            className={`w-full bg-slate-950 border rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none transition-all placeholder:text-slate-600 ${
              isGlobalSearchActive ? 'border-blue-500/50 text-blue-100' : 'border-slate-800 text-slate-200 focus:border-blue-500'
            }`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {isGlobalSearchActive && (
            <div className="absolute right-3 top-2 flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/20 rounded text-[9px] font-bold text-blue-400 uppercase tracking-tighter border border-blue-500/30">
              Global
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex p-1 bg-slate-950 rounded-lg border border-slate-800 mr-2">
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-slate-800 text-blue-400' : 'text-slate-600 hover:text-slate-400'}`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-slate-800 text-blue-400' : 'text-slate-600 hover:text-slate-400'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          
          <button 
            onClick={() => {
              const input = document.getElementById('batch-upload-input');
              input?.click();
            }}
            disabled={!selectedAdvertiser}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 rounded-lg text-sm font-semibold transition-all border border-emerald-500/30 disabled:opacity-50 disabled:grayscale"
          >
            <UploadCloud className="w-4 h-4" />
            Batch Upload
          </button>

          <button
            onClick={() => setIsBulkEditPanelOpen(true)}
            disabled={!selectedAdvertiser}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-800/60 hover:bg-slate-800 text-slate-200 rounded-lg text-sm font-semibold transition-all border border-slate-700 disabled:opacity-50 disabled:grayscale"
          >
            <SearchCode className="w-4 h-4" />
            Edit
          </button>

          <div className="relative">
            <button
              onClick={() => setIsNewMenuOpen(!isNewMenuOpen)}
              disabled={toast.type === 'loading' && toast.show}
              className={`flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {toast.type === 'loading' && toast.show ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              New
              <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${isNewMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isNewMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsNewMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-40 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-2 border-b border-slate-800 bg-slate-950/50">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-2">Creative</span>
                  </div>
                  <div className="p-1">
                    <button 
                      onClick={() => {
                        setIsGlobalSearchActive(!isGlobalSearchActive);
                        setIsNewMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors ${
                        isGlobalSearchActive 
                          ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' 
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <SearchCode className="w-4 h-4" />
                        Add from advertiser
                      </div>
                      {isGlobalSearchActive && <Check className="w-3 h-3" />}
                    </button>
                  </div>

                  <div className="p-2 border-b border-slate-800 bg-slate-950/50 mt-1">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-2">Standard</span>
                  </div>
                  <div className="p-1">
                    <button 
                      disabled={!selectedAdvertiser}
                      onClick={() => {
                        const input = document.getElementById('single-upload-input');
                        input?.click();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ImageIcon className="w-4 h-4 text-blue-500" />
                      Display
                    </button>
                    <button 
                      disabled={!selectedAdvertiser}
                      onClick={() => {
                        const input = document.getElementById('single-upload-input');
                        input?.click();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Video className="w-4 h-4 text-rose-500" />
                      In-stream video
                    </button>
                  </div>
                </div>
              </>
            )}

            <input 
              type="file" 
              id="single-upload-input" 
              className="hidden" 
              onChange={(e) => handleFileUpload(e, false)}
              accept="image/*,video/*"
            />
            <input 
              type="file" 
              id="batch-upload-input" 
              className="hidden" 
              multiple
              onChange={(e) => handleFileUpload(e, true)}
              accept="image/*,video/*"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 custom-scrollbar relative">
        {batchProgress && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-full max-w-md animate-in slide-in-from-top-4 duration-300">
            <div className="bg-blue-600 rounded-2xl p-4 shadow-2xl shadow-blue-500/20 border border-blue-400/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-blue-100 uppercase tracking-widest">Batch Upload Progress</span>
                <span className="text-[10px] font-bold text-white">{batchProgress.current} / {batchProgress.total}</span>
              </div>
              <div className="w-full h-1.5 bg-blue-900/50 rounded-full overflow-hidden mb-2">
                <div 
                  className="h-full bg-white transition-all duration-300" 
                  style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-blue-100 font-medium truncate italic">{batchProgress.status}</p>
            </div>
          </div>
        )}

        {!selectedAdvertiser ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6 border border-slate-800">
              <AlertCircle className="w-8 h-8 text-amber-500" />
            </div>
            <h3 className="text-slate-300 font-bold">No Advertiser Selected</h3>
            <p className="text-slate-500 text-xs mt-1 max-w-xs mx-auto">Please select an advertiser from the sidebar to view its creative assets.</p>
          </div>
        ) : filteredCreatives.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6 border border-slate-800">
              <ImageIcon className="w-8 h-8 text-slate-700" />
            </div>
            <h3 className="text-slate-300 font-bold">No creatives found</h3>
            <p className="text-slate-500 text-xs mt-1 max-w-xs mx-auto">Try syncing assets or adjusting your search terms.</p>
            <button 
              onClick={handleRefresh}
              className="mt-6 text-blue-500 hover:text-blue-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2 mx-auto"
            >
              <RefreshCw className="w-4 h-4" /> Sync now
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
            {filteredCreatives.map((creative) => (
              <div key={creative.id} className="group bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden hover:border-blue-500/30 transition-all hover:shadow-xl hover:shadow-blue-500/5">
                <div className="aspect-square bg-slate-950 relative overflow-hidden flex items-center justify-center border-b border-slate-800">
                  {renderCreativePlaceholder(creative)}
                  <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                    {creative.externalUrl && (
                      <a 
                        href={creative.externalUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="p-2 bg-blue-600 rounded-lg text-white hover:bg-blue-500 transition-colors shadow-lg flex items-center justify-center"
                        title="View in CM360"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    <div className="relative">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveActionMenu(activeActionMenu === creative.id ? null : creative.id);
                        }}
                        className="p-2 bg-slate-800 rounded-lg text-white hover:bg-slate-700 transition-colors border border-slate-700"
                        title="Actions"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {activeActionMenu === creative.id && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                          <button 
                            onClick={() => {
                              setCreativeToAssign(creative);
                              setActiveModal('advertiser');
                              setActiveActionMenu(null);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                          >
                            <Layers className="w-3.5 h-3.5" />
                            Assign to Advertiser
                          </button>
                          <button 
                            onClick={() => {
                              setCreativeToAssign(creative);
                              setDestAdvertiserId(selectedAdvertiser?.id || '');
                              setActiveModal('campaign');
                              setActiveActionMenu(null);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                          >
                            <LayoutDashboard className="w-3.5 h-3.5" />
                            Assign to Campaign
                          </button>
                          <button 
                            onClick={() => {
                              setCreativeToAssign(creative);
                              setDestCampaignId(selectedCampaign?.id || '');
                              setActiveModal('placement');
                              setActiveActionMenu(null);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Assign to Placement (Ad)
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="absolute top-3 left-3">
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-600/20 backdrop-blur-md border border-blue-500/30 text-[9px] font-bold text-blue-200 uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-sm bg-blue-400" />
                      {creative.size}
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <h4 className="text-xs font-bold text-slate-200 truncate" title={creative.name}>
                        {creative.name}
                      </h4>
                      {creative.isDraft && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold uppercase">Draft</span>}
                      <button 
                        onClick={() => handleCopy(creative.name, creative.id)}
                        className={`shrink-0 p-1 rounded transition-all ${
                          copiedId === creative.id ? 'text-emerald-500 bg-emerald-500/10' : 'text-slate-600 hover:text-slate-400 hover:bg-slate-800'
                        }`}
                        title="Copy name"
                      >
                        {copiedId === creative.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                    {getIcon(creative.type)}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 font-medium truncate max-w-[120px]">
                      {creative.type.replace(/_/g, ' ')}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1 h-1 rounded-full ${creative.status === 'Active' ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-tighter">{creative.status}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="list-surface bg-[#152542] border border-[#2a4163] rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <colgroup>
                <col style={{ width: listColumnWidths.preview }} />
                <col style={{ width: listColumnWidths.name }} />
                <col style={{ width: listColumnWidths.type }} />
                <col style={{ width: listColumnWidths.size }} />
                <col style={{ width: listColumnWidths.status }} />
                <col style={{ width: 64 }} />
              </colgroup>
              <thead>
                <tr className="list-header-row bg-[#1b2d4d] border-b border-[#2a4163]">
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 relative">Preview<div className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startListResize('preview', e.clientX, listColumnWidths.preview)} /></th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 relative">Name<div className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startListResize('name', e.clientX, listColumnWidths.name)} /></th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 relative">Type<div className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startListResize('type', e.clientX, listColumnWidths.type)} /></th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 relative">Dimensions<div className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startListResize('size', e.clientX, listColumnWidths.size)} /></th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 relative">Status<div className="absolute right-0 top-0 h-full w-1 cursor-col-resize" onMouseDown={(e) => startListResize('status', e.clientX, listColumnWidths.status)} /></th>
                  <th className="p-4 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#263a5b]">
                {filteredCreatives.map((creative) => (
                  <tr key={creative.id} className="list-row group hover:bg-[#1b2d4d]/60 transition-colors">
                    <td className="p-4">
                      <div className="w-10 h-10 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden flex items-center justify-center">
                        {renderCreativePlaceholder(creative, true)}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-200">{creative.name}</span>
                        {creative.isDraft && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold uppercase">Draft</span>}
                        <button 
                          onClick={() => handleCopy(creative.name, creative.id)}
                          className={`p-1 rounded transition-all ${
                            copiedId === creative.id ? 'text-emerald-500 bg-emerald-500/10' : 'text-slate-600 hover:text-slate-400 hover:bg-slate-800'
                          }`}
                          title="Copy name"
                        >
                          {copiedId === creative.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </td>
                    <td className="p-4 text-sm font-bold text-slate-300 uppercase tracking-wider">{creative.type.replace(/_/g, ' ')}</td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-700/40 border border-slate-500/40 text-sm font-bold text-slate-200">
                        <span className="w-1.5 h-1.5 rounded-sm bg-slate-300" />
                        {creative.size}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${creative.isDraft ? 'bg-amber-500' : creative.active ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-slate-600'}`} />
                        <span className={`text-sm font-bold uppercase tracking-widest ${creative.isDraft ? 'text-amber-400' : creative.active ? 'text-emerald-400' : 'text-slate-300'}`}>
                          {creative.isDraft ? 'Draft' : (creative.active ? 'Active' : 'Paused')}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {creative.externalUrl && (
                          <a 
                            href={creative.externalUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-md text-blue-400 hover:bg-blue-400/10 transition-all"
                            title="Open in CM360"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        <div className="relative">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveActionMenu(activeActionMenu === creative.id ? null : creative.id);
                            }}
                            className="p-1.5 rounded-md text-slate-600 hover:bg-slate-800 hover:text-slate-300 transition-all"
                            title="Actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {activeActionMenu === creative.id && (
                            <div className="absolute right-full top-0 mr-2 w-48 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-right-2">
                              <button 
                                onClick={() => {
                                  setCreativeToAssign(creative);
                                  setActiveModal('advertiser');
                                  setActiveActionMenu(null);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                              >
                                <Layers className="w-3.5 h-3.5" />
                                Assign to Advertiser
                              </button>
                              <button 
                                onClick={() => {
                                  setCreativeToAssign(creative);
                                  setDestAdvertiserId(selectedAdvertiser?.id || '');
                                  setActiveModal('campaign');
                                  setActiveActionMenu(null);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                              >
                                <LayoutDashboard className="w-3.5 h-3.5" />
                                Assign to Campaign
                              </button>
                              <button 
                                onClick={() => {
                                  setCreativeToAssign(creative);
                                  setDestCampaignId(selectedCampaign?.id || '');
                                  setActiveModal('placement');
                                  setActiveActionMenu(null);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-xs text-slate-300 hover:bg-blue-600 hover:text-white transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                Assign to Placement (Ad)
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Toast 
        {...toast} 
        onClose={() => setToast(prev => ({ ...prev, show: false }))} 
      />

      {isBulkEditPanelOpen && (
        <CreativeBulkEditPanel
          onClose={() => setIsBulkEditPanelOpen(false)}
          onToast={setToast}
        />
      )}

      {/* Upload Confirmation Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-4 overflow-y-auto bg-slate-950/80 backdrop-blur-sm">
          <div className="my-4 max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-2">
              {pendingFiles.length > 0 ? `Batch Upload (${pendingFiles.length} files)` : 'Configure Creative'}
            </h3>
            <p className="text-slate-400 text-sm mb-6">
              {pendingFiles.length > 0 
                ? 'Select a common format and size for all files in this batch.' 
                : (selectedCampaign ? `Uploading to Campaign: ${selectedCampaign.name}` : 'Review the name and format before uploading to CM360.')}
            </p>
            
            <div className="space-y-4">
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                <label className="text-[10px] uppercase font-bold text-slate-500">Destination Context</label>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-600 mb-1">Advertiser</label>
                    <select
                      value={selectedAdvertiser?.id || ''}
                      onChange={(e) => {
                        const advertiser = advertisers.find((item) => item.id === e.target.value) || null;
                        setSelectedAdvertiser(advertiser);
                        setSelectedCampaign(null);
                        if (advertiser) fetchCampaigns(advertiser.id);
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Select advertiser</option>
                      {advertisers.map((advertiser) => (
                        <option key={advertiser.id} value={advertiser.id}>{advertiser.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-600 mb-1">Campaign</label>
                    <select
                      value={selectedCampaign?.id || ''}
                      onChange={(e) => {
                        const campaign = campaigns.find((item) => item.id === e.target.value) || null;
                        setSelectedCampaign(campaign);
                        setSelectedSiteIds(null);
                        if (campaign) {
                          fetchAds(campaign.id);
                          fetchPlacements(campaign.id);
                          fetchSites();
                        }
                      }}
                      disabled={!selectedAdvertiser}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    >
                      <option value="">Select campaign</option>
                      {campaigns
                        .filter((campaign) => !selectedAdvertiser || campaign.advertiserId === selectedAdvertiser.id)
                        .map((campaign) => (
                          <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>

              {pendingFiles.length > 0 && (
                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
                  <label className="text-[10px] uppercase font-bold text-slate-500">Naming Convention</label>

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-slate-600 mb-1">Prefix</label>
                        <input
                          type="text"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition-all"
                          value={namingPrefix}
                          onChange={(e) => setNamingPrefix(e.target.value)}
                          placeholder="Prefix text..."
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-slate-600 mb-1">Suffix</label>
                        <input
                          type="text"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition-all"
                          value={namingSuffix}
                          onChange={(e) => setNamingSuffix(e.target.value)}
                          placeholder="Suffix text..."
                        />
                      </div>
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className={`w-8 h-4 rounded-full transition-all relative ${includeDate ? 'bg-blue-600' : 'bg-slate-800'}`}>
                        <div className={`absolute top-1 w-2 h-2 bg-white rounded-full transition-all ${includeDate ? 'left-5' : 'left-1'}`} />
                      </div>
                      <input 
                        type="checkbox" 
                        className="hidden" 
                        checked={includeDate} 
                        onChange={() => setIncludeDate(!includeDate)} 
                      />
                      <span className="text-[10px] font-bold text-slate-400 group-hover:text-slate-300 transition-colors">Append current date (DD-MM-YYYY)</span>
                    </label>
                  </div>
                </div>
              )}

              {pendingFiles.length === 0 && (
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Base Name</label>
                  <div className="flex items-center gap-2">
                    {selectedCampaign && (
                      <span className="px-2 py-3 bg-slate-950 border border-slate-800 rounded-xl text-[10px] font-mono text-slate-500">
                        {selectedCampaign.name.substring(0, 10)}_
                      </span>
                    )}
                    <input 
                      type="text"
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Creative name..."
                    />
                  </div>
                </div>
              )}

              {pendingFiles.length === 0 && (
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Tech</label>
                  <select
                    value={selectedTech}
                    onChange={(e) => setSelectedTech(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                  >
                    {TECH_OPTIONS.map((tech) => (
                      <option key={tech} value={tech}>{tech}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-500 mt-2">This token is inserted before Format in creative naming.</p>
                </div>
              )}

              {pendingFiles.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[10px] uppercase font-bold text-slate-500">Sites</label>
                    {campaignSites.length > 0 && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedSiteIds(new Set(campaignSites.map((s) => s.id)))}
                          className="text-[9px] font-bold text-blue-400 hover:text-blue-300"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedSiteIds(new Set())}
                          className="text-[9px] font-bold text-slate-500 hover:text-slate-400"
                        >
                          Clear
                        </button>
                      </div>
                    )}
                  </div>
                  {!selectedCampaign && (
                    <p className="text-[10px] text-slate-500">Select a campaign first to load its Sites from CM360.</p>
                  )}
                  {selectedCampaign && campaignSites.length === 0 && (
                    <p className="text-[10px] text-slate-500">No Sites found for this campaign's Placements yet. They will appear once Placements load.</p>
                  )}
                  {campaignSites.length > 0 && (
                    <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                      {campaignSites.map((site) => {
                        const checked = effectiveSelectedSiteIds.has(site.id);
                        return (
                          <label
                            key={site.id}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-all ${checked ? 'border-blue-500/50 bg-blue-600/10 text-slate-200' : 'border-slate-800 bg-slate-950 text-slate-500'}`}
                          >
                            <input
                              type="checkbox"
                              className="accent-blue-500"
                              checked={checked}
                              onChange={(e) => {
                                const next = new Set(effectiveSelectedSiteIds);
                                if (e.target.checked) next.add(site.id); else next.delete(site.id);
                                setSelectedSiteIds(next);
                              }}
                            />
                            <span className="truncate">{site.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500 mt-2">Selected Sites are used in the file name and filter which Ads are eligible for auto-assignment. All Sites for this campaign are selected by default.</p>
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Format</label>
                <select
                  value={selectedFormat}
                  onChange={(e) => {
                    const nextFormat = e.target.value;
                    setSelectedFormat(nextFormat);
                    setSelectedSize(CREATIVE_SPECS[nextFormat][0]);
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
                >
                  {CREATIVE_FORMATS.map((format) => (
                    <option key={format} value={format}>{format}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Size / Variant</label>
                <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto custom-scrollbar pr-1">
                  {CREATIVE_SPECS[selectedFormat].map(size => (
                    <button
                      key={size}
                      onClick={() => setSelectedSize(size)}
                      className={`py-2 px-3 rounded-lg text-[10px] font-bold transition-all border text-left ${
                        selectedSize === size 
                          ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400' 
                          : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-400'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[10px] uppercase font-bold text-slate-500">Ad Assignment</label>
                </div>

                {pendingFiles.length > 1 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                    <button
                      onClick={() => setBatchAssignmentMode('auto')}
                      className={`py-2 rounded-lg text-[10px] font-bold border transition-all ${batchAssignmentMode === 'auto' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'}`}
                    >
                      Auto-match by size
                    </button>
                    <button
                      onClick={() => setBatchAssignmentMode('single')}
                      className={`py-2 rounded-lg text-[10px] font-bold border transition-all ${batchAssignmentMode === 'single' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'}`}
                    >
                      Assign all to one Ad
                    </button>
                    <button
                      onClick={() => setBatchAssignmentMode('none')}
                      className={`py-2 rounded-lg text-[10px] font-bold border transition-all ${batchAssignmentMode === 'none' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'}`}
                    >
                      Upload only
                    </button>
                  </div>
                )}

                <select
                  value={uploadAdId}
                  onChange={(e) => setUploadAdId(e.target.value)}
                  disabled={!selectedCampaign || (pendingFiles.length > 1 && batchAssignmentMode !== 'single')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all disabled:opacity-50"
                >
                  <option value="">No ad assignment</option>
                  {campaignAds.map((ad) => (
                    <option key={ad.id} value={ad.id} disabled={isDefaultAd(ad)}>
                      {isDefaultAd(ad) ? `[DEFAULT - LOCKED] ${ad.name}` : ad.name}
                    </option>
                  ))}
                </select>
                {((pendingFiles.length === 0) || (pendingFiles.length > 1 && batchAssignmentMode === 'single')) && (
                  <div className="mt-2">
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Assignment Mode</label>
                    <select
                      value={uploadAssignMode}
                      onChange={(e) => setUploadAssignMode(e.target.value as 'add' | 'replace')}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                    >
                      <option value="add">Add (keep existing creatives)</option>
                      <option value="replace">Replace (overwrite current creatives in Ad)</option>
                    </select>
                  </div>
                )}
                {!selectedCampaign && (
                  <p className="text-[10px] text-slate-500 mt-2">Select a campaign first to load Ads from CM360.</p>
                )}
                {pendingFiles.length > 1 && batchAssignmentMode === 'auto' && selectedCampaign && (
                  <p className="text-[10px] text-blue-400 mt-2">For batch uploads, Ad will be auto-matched by detected size (filename + file dimensions). If multiple Ads share the same size, manual selection is required per file.</p>
                )}
                {pendingFiles.length > 1 && batchAssignmentMode === 'single' && (
                  <p className="text-[10px] text-slate-400 mt-2">All creatives in this batch will be assigned to the selected Ad.</p>
                )}
                {pendingFiles.length > 1 && batchAssignmentMode === 'none' && (
                  <p className="text-[10px] text-slate-400 mt-2">Creatives will be uploaded without Ad assignment.</p>
                )}
              </div>

              {pendingFiles.length === 0 && (
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 mt-4">
                  <label className="block text-[9px] uppercase font-bold text-slate-600 mb-1">Final Name Preview</label>
                    <p className="text-xs font-mono text-blue-400 truncate">
                     {joinNameTokens([
                       selectedCampaign ? selectedCampaign.name.substring(0, 10) : '',
                       customName,
                       (selectedTech || 'DV360').trim().toUpperCase(),
                       selectedFormat,
                       selectedSize.replace(/\s+/g, '_')
                     ])}
                    </p>
                  </div>
                )}
              
              <div className="flex gap-3 pt-4 flex-wrap">
                <button 
                  onClick={() => {
                    setIsUploadModalOpen(false);
                    setPendingFiles([]);
                    setPendingFile(null);
                    setBatchPlans([]);
                    setManualPlanIndex(null);
                    setApplyManualSelectionToSameSize(true);
                  }}
                  className="flex-1 py-3 text-slate-400 hover:text-white font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmUpload}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-600/20"
                >
                  {pendingFiles.length > 0 ? 'Start Batch' : 'Confirm & Upload'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {manualPlanIndex !== null && batchPlans[manualPlanIndex] && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-2">Review Ads for file</h3>
            <p className="text-slate-400 text-sm mb-5">
              {batchPlans[manualPlanIndex].candidateAds.filter((ad) => !isDefaultAd(ad)).length} Ads were found for size <span className="text-blue-400 font-bold">{batchPlans[manualPlanIndex].finalSize}</span>. All are selected by default — uncheck any that shouldn't receive this creative.
            </p>

            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 mb-4">
              <p className="text-xs text-slate-300 font-semibold truncate">{batchPlans[manualPlanIndex].file.name}</p>
              <p className="text-[10px] text-slate-500 mt-2">
                Name size: {batchPlans[manualPlanIndex].sizeFromName || 'not detected'} · File size: {batchPlans[manualPlanIndex].sizeFromFile || 'not detected'}
              </p>
              {batchPlans[manualPlanIndex].mismatch && (
                <p className="text-[10px] text-amber-400 mt-2">Filename size and real file dimensions differ. Using real dimensions.</p>
              )}
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
              {batchPlans[manualPlanIndex].candidateAds.map((ad) => {
                const checked = batchPlans[manualPlanIndex].selectedAdIds.includes(ad.id);
                return (
                  <label
                    key={ad.id}
                    className={`flex items-center gap-3 w-full text-left p-3 rounded-xl border transition-all ${
                      isDefaultAd(ad)
                        ? 'border-slate-700 bg-slate-900/60 text-slate-500 cursor-not-allowed'
                        : checked
                          ? 'border-blue-500/50 bg-blue-600/10 cursor-pointer'
                          : 'border-slate-800 bg-slate-950 hover:border-blue-500/50 hover:bg-blue-600/10 cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-blue-500"
                      checked={checked}
                      disabled={isDefaultAd(ad)}
                      onChange={() => handleToggleManualAd(ad.id)}
                    />
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold truncate ${isDefaultAd(ad) ? 'text-slate-500' : 'text-slate-200'}`}>
                        {isDefaultAd(ad) ? `[DEFAULT - LOCKED] ${ad.name}` : ad.name}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1 font-mono">Ad ID: {ad.id}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            <label className="mt-4 flex items-center gap-2 text-[11px] text-slate-300">
              <input
                type="checkbox"
                checked={applyManualSelectionToSameSize}
                onChange={(e) => setApplyManualSelectionToSameSize(e.target.checked)}
                className="accent-blue-500"
              />
              Apply this selection to remaining files with the same size ({batchPlans[manualPlanIndex].finalSize})
            </label>

            <div className="flex gap-3 pt-6">
              <button
                onClick={handleManualSkipFile}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Skip this file
              </button>
              <button
                onClick={handleManualConfirm}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all"
              >
                Confirm ({batchPlans[manualPlanIndex].selectedAdIds.length} selected)
              </button>
            </div>
          </div>
        </div>
      )}

      {batchReport !== null && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-3xl max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-bold text-white">Batch Upload Report</h3>
              <button
                onClick={() => setBatchReport(null)}
                className="text-slate-500 hover:text-white"
              >
                <XIcon size={18} />
              </button>
            </div>
            <p className="text-slate-400 text-sm mb-5">
              {batchReport.filter((r) => r.status === 'assigned' || r.status === 'uploaded_only').length} of {batchReport.length} files completed without issues.
              {batchReport.some((r) => r.status === 'skipped') && ' Some files were skipped by you during manual Ad selection.'}
              {batchReport.some((r) => r.status === 'assign_failed' || r.status === 'upload_failed') && ' Some files need attention — see details below.'}
            </p>

            <div className="space-y-2">
              {batchReport.map((row, idx) => {
                const statusStyles: Record<BatchReportRow['status'], { label: string; className: string }> = {
                  assigned: { label: 'Uploaded & Assigned', className: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' },
                  uploaded_only: { label: 'Uploaded (no assignment)', className: 'text-blue-400 border-blue-500/40 bg-blue-500/10' },
                  skipped: { label: 'Assignment Skipped', className: 'text-amber-400 border-amber-500/40 bg-amber-500/10' },
                  assign_failed: { label: 'Assignment Failed', className: 'text-rose-400 border-rose-500/40 bg-rose-500/10' },
                  upload_failed: { label: 'Upload Failed', className: 'text-rose-400 border-rose-500/40 bg-rose-500/10' },
                };
                const style = statusStyles[row.status];
                return (
                  <div key={idx} className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-xs font-semibold text-slate-200 truncate">{row.fileName}</p>
                      <span className={`text-[9px] font-bold uppercase px-2 py-1 rounded-full border ${style.className}`}>{style.label}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Size: <span className="text-slate-300 font-mono">{row.size}</span>
                      {' · '}Sites: <span className="text-slate-300">{row.siteNames}</span>
                      {row.adName && (
                        <>{' · '}Ad: <span className="text-slate-300">{row.adName}</span></>
                      )}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1">{row.detail}</p>
                    {row.link && (
                      <a href={row.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 mt-1">
                        View in CM360 <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3 pt-6">
              <button
                onClick={() => setBatchReport(null)}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment Modals */}
      {activeModal === 'advertiser' && creativeToAssign && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-2">Assign to Advertiser</h3>
            <p className="text-slate-400 text-sm mb-6">This will copy the creative "{creativeToAssign.name}" to the selected advertiser's library.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Destination Advertiser</label>
                <select 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all appearance-none"
                  value={destAdvertiserId}
                  onChange={(e) => setDestAdvertiserId(e.target.value)}
                >
                  <option value="">Select an advertiser...</option>
                  {advertisers.map(adv => (
                    <option key={adv.id} value={adv.id}>{adv.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setActiveModal(null)}
                  className="flex-1 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAssign}
                  disabled={!destAdvertiserId || isAssigning}
                  className="flex-1 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'campaign' && creativeToAssign && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-2">Assign to Campaign</h3>
            <p className="text-slate-400 text-sm mb-6">The creative "{creativeToAssign.name}" will be made available in the selected campaign.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Advertiser</label>
                <select 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all appearance-none"
                  value={destAdvertiserId}
                  onChange={(e) => setDestAdvertiserId(e.target.value)}
                >
                  <option value="">Select an advertiser...</option>
                  {advertisers.map(adv => (
                    <option key={adv.id} value={adv.id}>{adv.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Campaign</label>
                <select 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all appearance-none"
                  value={destCampaignId}
                  onChange={(e) => setDestCampaignId(e.target.value)}
                  disabled={!destAdvertiserId}
                >
                  <option value="">Select a campaign...</option>
                  {campaigns.map(camp => (
                    <option key={camp.id} value={camp.id}>{camp.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setActiveModal(null)}
                  className="flex-1 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    handleAssign();
                  }}
                  disabled={!destCampaignId || isAssigning}
                  className="flex-1 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm Assignment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'placement' && creativeToAssign && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-2">Assign to Placement (Ad)</h3>
            <p className="text-slate-400 text-sm mb-6">Create a new Ad linking "{creativeToAssign.name}" to a specific placement.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Campaign</label>
                <select 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all appearance-none"
                  value={destCampaignId}
                  onChange={(e) => setDestCampaignId(e.target.value)}
                >
                  <option value="">Select a campaign...</option>
                  {campaigns.map(camp => (
                    <option key={camp.id} value={camp.id}>{camp.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Placement</label>
                <select 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all appearance-none"
                  value={destPlacementId}
                  onChange={(e) => setDestPlacementId(e.target.value)}
                  disabled={!destCampaignId}
                >
                  <option value="">Select a placement...</option>
                  {placements.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.size})</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setActiveModal(null)}
                  className="flex-1 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAssignToPlacement}
                  disabled={!destPlacementId || isAssigning}
                  className="flex-1 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Ad'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Guide Modal */}
      {isErrorGuideOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 w-full max-w-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 relative">
            <button 
              onClick={() => setIsErrorGuideOpen(false)}
              className="absolute top-6 right-6 p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
            >
              <XIcon className="w-5 h-5" />
            </button>
            
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-blue-600/10 rounded-xl flex items-center justify-center">
                <HelpCircle className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Guía de Errores CM360</h3>
                <p className="text-slate-400 text-sm">Traducción de errores técnicos a lenguaje natural.</p>
              </div>
            </div>
            
            <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
              {Object.entries(CM360_ERROR_MAPPING).map(([code, error]) => (
                <div key={code} className="p-4 bg-slate-950/50 border border-slate-800 rounded-2xl hover:border-slate-700 transition-all">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">{code === 'default' ? 'Otros' : `Error ${code}`}</span>
                    <span className="text-xs font-bold text-blue-400">{error.title}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{error.description}</p>
                </div>
              ))}
            </div>
            
            <div className="mt-8 p-4 bg-blue-600/5 border border-blue-500/20 rounded-2xl">
              <p className="text-[11px] text-blue-400/80 leading-relaxed italic">
                * El error 100012 suele ocurrir cuando el formato elegido (ej: Video) no coincide con el archivo subido (ej: una imagen .png). Asegúrate de que el archivo y el formato seleccionado en la modal sean coherentes.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreativeGrid;
