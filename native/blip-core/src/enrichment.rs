use maxminddb::Reader;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};
use std::str::FromStr;

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct EnrichmentResult {
    pub asn: Option<u32>,
    pub asn_org: Option<String>,
    pub cloud_provider: Option<String>,
    pub cloud_region: Option<String>,
    pub datacenter: Option<String>,
    pub is_cdn: bool,
    pub network_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SelfIpInfo {
    pub isp: Option<String>,
    pub asn: Option<u32>,
    pub network_type: Option<String>,
}

// ---------------------------------------------------------------------------
// ASN MMDB record (DB-IP format)
// ---------------------------------------------------------------------------

#[derive(Deserialize, Debug)]
struct AsnRecord {
    autonomous_system_number: Option<u32>,
    autonomous_system_organization: Option<String>,
}

// ---------------------------------------------------------------------------
// Cloud IP range types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct CidrRange {
    network: u32,
    mask: u32,
}

#[derive(Debug, Clone)]
struct CloudRange {
    cidr: CidrRange,
    provider: String,
    region: Option<String>,
    service: Option<String>,
}

// ---------------------------------------------------------------------------
// AWS JSON schema
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct AwsRanges {
    prefixes: Vec<AwsPrefix>,
}

#[derive(Deserialize)]
struct AwsPrefix {
    ip_prefix: String,
    region: Option<String>,
    service: Option<String>,
}

// ---------------------------------------------------------------------------
// GCP JSON schema
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GcpRanges {
    prefixes: Vec<GcpPrefix>,
}

#[derive(Deserialize)]
struct GcpPrefix {
    #[serde(rename = "ipv4Prefix")]
    ipv4_prefix: Option<String>,
    scope: Option<String>,
}

// ---------------------------------------------------------------------------
// Known CDN ASNs
// ---------------------------------------------------------------------------

fn cdn_asn_map() -> HashMap<u32, &'static str> {
    let mut m = HashMap::new();
    m.insert(13335, "Cloudflare");
    m.insert(20940, "Akamai");
    m.insert(54113, "Fastly");
    m
}

fn cloud_asn_map() -> HashMap<u32, &'static str> {
    let mut m = HashMap::new();
    m.insert(16509, "AWS");
    m.insert(14618, "AWS");
    m.insert(15169, "Google");
    m.insert(8075, "Azure");
    m.insert(16276, "OVH");
    m
}

// ---------------------------------------------------------------------------
// Known hosting / datacenter ASNs (used for network_type classification)
// ---------------------------------------------------------------------------

fn hosting_asns() -> Vec<u32> {
    vec![
        16509, 14618, // AWS
        15169,        // Google
        8075,         // Microsoft / Azure
        16276,        // OVH
        13335,        // Cloudflare
        20940,        // Akamai
        54113,        // Fastly
        24940,        // Hetzner
        63949,        // Linode / Akamai Connected Cloud
        14061,        // DigitalOcean
        20473,        // Vultr
    ]
}

// ---------------------------------------------------------------------------
// Hardcoded Cloudflare IPv4 ranges (from cloudflare.com/ips-v4)
// ---------------------------------------------------------------------------

fn cloudflare_ipv4_cidrs() -> Vec<&'static str> {
    vec![
        "173.245.48.0/20",
        "103.21.244.0/22",
        "103.22.200.0/22",
        "103.31.4.0/22",
        "141.101.64.0/18",
        "108.162.192.0/18",
        "190.93.240.0/20",
        "188.114.96.0/20",
        "197.234.240.0/22",
        "198.41.128.0/17",
        "162.158.0.0/15",
        "104.16.0.0/13",
        "104.24.0.0/14",
        "172.64.0.0/13",
        "131.0.72.0/22",
    ]
}

// ---------------------------------------------------------------------------
// Cloud region friendly names
// ---------------------------------------------------------------------------

fn region_friendly_names() -> HashMap<&'static str, &'static str> {
    let mut m = HashMap::new();
    // AWS regions
    m.insert("us-east-1", "N. Virginia");
    m.insert("us-east-2", "Ohio");
    m.insert("us-west-1", "N. California");
    m.insert("us-west-2", "Oregon");
    m.insert("af-south-1", "Cape Town");
    m.insert("ap-east-1", "Hong Kong");
    m.insert("ap-south-1", "Mumbai");
    m.insert("ap-south-2", "Hyderabad");
    m.insert("ap-southeast-1", "Singapore");
    m.insert("ap-southeast-2", "Sydney");
    m.insert("ap-southeast-3", "Jakarta");
    m.insert("ap-southeast-4", "Melbourne");
    m.insert("ap-northeast-1", "Tokyo");
    m.insert("ap-northeast-2", "Seoul");
    m.insert("ap-northeast-3", "Osaka");
    m.insert("ca-central-1", "Canada");
    m.insert("eu-central-1", "Frankfurt");
    m.insert("eu-central-2", "Zurich");
    m.insert("eu-west-1", "Ireland");
    m.insert("eu-west-2", "London");
    m.insert("eu-west-3", "Paris");
    m.insert("eu-south-1", "Milan");
    m.insert("eu-south-2", "Spain");
    m.insert("eu-north-1", "Stockholm");
    m.insert("il-central-1", "Tel Aviv");
    m.insert("me-south-1", "Bahrain");
    m.insert("me-central-1", "UAE");
    m.insert("sa-east-1", "São Paulo");
    // GCP regions
    m.insert("us-central1", "Iowa");
    m.insert("us-east1", "S. Carolina");
    m.insert("us-east4", "N. Virginia");
    m.insert("us-east5", "Columbus");
    m.insert("us-south1", "Dallas");
    m.insert("us-west1", "Oregon");
    m.insert("us-west2", "Los Angeles");
    m.insert("us-west3", "Salt Lake City");
    m.insert("us-west4", "Las Vegas");
    m.insert("northamerica-northeast1", "Montréal");
    m.insert("northamerica-northeast2", "Toronto");
    m.insert("southamerica-east1", "São Paulo");
    m.insert("europe-west1", "Belgium");
    m.insert("europe-west2", "London");
    m.insert("europe-west3", "Frankfurt");
    m.insert("europe-west4", "Netherlands");
    m.insert("europe-west6", "Zurich");
    m.insert("europe-west8", "Milan");
    m.insert("europe-west9", "Paris");
    m.insert("europe-north1", "Finland");
    m.insert("europe-central2", "Warsaw");
    m.insert("asia-south1", "Mumbai");
    m.insert("asia-south2", "Delhi");
    m.insert("asia-southeast1", "Singapore");
    m.insert("asia-southeast2", "Jakarta");
    m.insert("asia-east1", "Taiwan");
    m.insert("asia-east2", "Hong Kong");
    m.insert("asia-northeast1", "Tokyo");
    m.insert("asia-northeast2", "Osaka");
    m.insert("asia-northeast3", "Seoul");
    m.insert("australia-southeast1", "Sydney");
    m.insert("australia-southeast2", "Melbourne");
    m.insert("me-west1", "Tel Aviv");
    m.insert("me-central1", "Doha");
    // Azure regions (short form)
    m.insert("eastus", "Virginia");
    m.insert("eastus2", "Virginia");
    m.insert("westus", "California");
    m.insert("westus2", "Washington");
    m.insert("westus3", "Arizona");
    m.insert("centralus", "Iowa");
    m.insert("northcentralus", "Illinois");
    m.insert("southcentralus", "Texas");
    m.insert("westeurope", "Netherlands");
    m.insert("northeurope", "Ireland");
    m.insert("uksouth", "London");
    m.insert("ukwest", "Cardiff");
    m.insert("germanywestcentral", "Frankfurt");
    m.insert("francecentral", "Paris");
    m.insert("switzerlandnorth", "Zurich");
    m.insert("norwayeast", "Oslo");
    m.insert("swedencentral", "Gävle");
    m.insert("eastasia", "Hong Kong");
    m.insert("southeastasia", "Singapore");
    m.insert("japaneast", "Tokyo");
    m.insert("japanwest", "Osaka");
    m.insert("koreacentral", "Seoul");
    m.insert("australiaeast", "Sydney");
    m.insert("australiasoutheast", "Melbourne");
    m.insert("centralindia", "Pune");
    m.insert("southindia", "Chennai");
    m.insert("brazilsouth", "São Paulo");
    m.insert("canadacentral", "Toronto");
    m.insert("canadaeast", "Québec");
    m
}

// ---------------------------------------------------------------------------
// CIDR parsing and matching
// ---------------------------------------------------------------------------

impl CidrRange {
    fn parse(cidr: &str) -> Option<Self> {
        let parts: Vec<&str> = cidr.split('/').collect();
        if parts.len() != 2 {
            return None;
        }
        let addr = Ipv4Addr::from_str(parts[0]).ok()?;
        let prefix_len: u32 = parts[1].parse().ok()?;
        if prefix_len > 32 {
            return None;
        }
        let mask = if prefix_len == 0 {
            0u32
        } else {
            !0u32 << (32 - prefix_len)
        };
        let network = u32::from(addr) & mask;
        Some(CidrRange { network, mask })
    }

    fn contains(&self, ip: Ipv4Addr) -> bool {
        (u32::from(ip) & self.mask) == self.network
    }
}

// ---------------------------------------------------------------------------
// Enricher
// ---------------------------------------------------------------------------

pub struct Enricher {
    asn_reader: Option<Reader<Vec<u8>>>,
    cloud_ranges: Vec<CloudRange>,
    region_names: HashMap<&'static str, &'static str>,
    cdn_asns: HashMap<u32, &'static str>,
    cloud_asns: HashMap<u32, &'static str>,
    hosting_asns: Vec<u32>,
}

impl Enricher {
    /// Create a new Enricher, loading the ASN MMDB from `resource_dir/dbip-asn.mmdb`.
    /// Create an empty enricher (no ASN database loaded). Returns default results.
    pub fn empty() -> Self {
        Enricher {
            asn_reader: None,
            cloud_ranges: Vec::new(),
            region_names: region_friendly_names(),
            cdn_asns: cdn_asn_map(),
            cloud_asns: cloud_asn_map(),
            hosting_asns: hosting_asns(),
        }
    }

    pub fn new(resource_dir: &Path) -> Result<Self, String> {
        let mmdb_path = resource_dir.join("dbip-asn.mmdb");
        let asn_reader = Reader::open_readfile(&mmdb_path)
            .map_err(|e| format!("Failed to open ASN database at {}: {}", mmdb_path.display(), e))?;

        // Build Cloudflare ranges as initial cloud ranges
        let mut cloud_ranges = Vec::new();
        for cidr_str in cloudflare_ipv4_cidrs() {
            if let Some(cidr) = CidrRange::parse(cidr_str) {
                cloud_ranges.push(CloudRange {
                    cidr,
                    provider: "Cloudflare".to_string(),
                    region: None,
                    service: Some("CDN".to_string()),
                });
            }
        }

        Ok(Enricher {
            asn_reader: Some(asn_reader),
            cloud_ranges,
            region_names: region_friendly_names(),
            cdn_asns: cdn_asn_map(),
            cloud_asns: cloud_asn_map(),
            hosting_asns: hosting_asns(),
        })
    }

    /// Download and cache AWS + GCP IP range files, then parse them into cloud_ranges.
    /// Cached files are stored in `~/.blip/`.
    pub async fn load_cloud_ranges(&mut self) -> Result<(), String> {
        let cache_dir = Self::cache_dir()?;
        fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create cache dir: {}", e))?;

        let aws_path = cache_dir.join("aws-ip-ranges.json");
        let gcp_path = cache_dir.join("gcp-cloud.json");

        // Download AWS ranges
        let aws_data = Self::download_or_cache(
            "https://ip-ranges.amazonaws.com/ip-ranges.json",
            &aws_path,
        )
        .await?;

        // Download GCP ranges
        let gcp_data = Self::download_or_cache(
            "https://www.gstatic.com/ipranges/cloud.json",
            &gcp_path,
        )
        .await?;

        // Parse AWS
        if let Ok(aws) = serde_json::from_str::<AwsRanges>(&aws_data) {
            for prefix in aws.prefixes {
                if let Some(cidr) = CidrRange::parse(&prefix.ip_prefix) {
                    self.cloud_ranges.push(CloudRange {
                        cidr,
                        provider: "AWS".to_string(),
                        region: prefix.region,
                        service: prefix.service,
                    });
                }
            }
        } else {
            log::warn!("Failed to parse AWS IP ranges JSON");
        }

        // Parse GCP
        if let Ok(gcp) = serde_json::from_str::<GcpRanges>(&gcp_data) {
            for prefix in gcp.prefixes {
                if let Some(cidr_str) = &prefix.ipv4_prefix {
                    if let Some(cidr) = CidrRange::parse(cidr_str) {
                        self.cloud_ranges.push(CloudRange {
                            cidr,
                            provider: "GCP".to_string(),
                            region: prefix.scope.clone(),
                            service: None,
                        });
                    }
                }
            }
        } else {
            log::warn!("Failed to parse GCP IP ranges JSON");
        }

        log::info!(
            "Loaded {} cloud IP ranges (AWS + GCP + Cloudflare)",
            self.cloud_ranges.len()
        );
        Ok(())
    }

    /// Enrich a destination IP with ASN, cloud, CDN, and datacenter info.
    pub fn enrich(&self, ip: &str) -> EnrichmentResult {
        let mut result = EnrichmentResult {
            asn: None,
            asn_org: None,
            cloud_provider: None,
            cloud_region: None,
            datacenter: None,
            is_cdn: false,
            network_type: None,
        };

        let addr: IpAddr = match ip.parse() {
            Ok(a) => a,
            Err(_) => return result,
        };

        // ASN lookup
        if let Some(ref reader) = self.asn_reader {
            if let Ok(record) = reader.lookup::<AsnRecord>(addr) {
                result.asn = record.autonomous_system_number;
                result.asn_org = record.autonomous_system_organization.clone();
            }
        }

        // CDN detection by ASN
        if let Some(asn) = result.asn {
            if let Some(cdn_name) = self.cdn_asns.get(&asn) {
                result.is_cdn = true;
                result.network_type = Some("cdn".to_string());
                // Cloudflare is also a cloud provider
                if asn == 13335 {
                    result.cloud_provider = Some("Cloudflare".to_string());
                }
                result.datacenter = Some(format!("{} CDN", cdn_name));
            }
        }

        // Cloud provider detection by IP range
        if let IpAddr::V4(ipv4) = addr {
            for range in &self.cloud_ranges {
                if range.cidr.contains(ipv4) {
                    result.cloud_provider = Some(range.provider.clone());
                    result.cloud_region = range.region.clone();

                    // Build datacenter name
                    if let Some(ref region) = range.region {
                        let friendly = self
                            .region_names
                            .get(region.as_str())
                            .copied()
                            .unwrap_or("");
                        if friendly.is_empty() {
                            result.datacenter =
                                Some(format!("{} {}", range.provider, region));
                        } else {
                            result.datacenter = Some(format!(
                                "{} {} ({})",
                                range.provider, region, friendly
                            ));
                        }
                    } else {
                        result.datacenter = Some(range.provider.clone());
                    }

                    if !result.is_cdn {
                        result.network_type = Some("cloud".to_string());
                    }
                    break;
                }
            }
        }

        // Cloud provider detection by ASN (fallback)
        if result.cloud_provider.is_none() {
            if let Some(asn) = result.asn {
                if let Some(provider) = self.cloud_asns.get(&asn) {
                    result.cloud_provider = Some(provider.to_string());
                    if result.network_type.is_none() {
                        result.network_type = Some("cloud".to_string());
                    }
                }
            }
        }

        // Classify network_type if still unknown
        if result.network_type.is_none() {
            if let Some(asn) = result.asn {
                if self.hosting_asns.contains(&asn) {
                    result.network_type = Some("cloud".to_string());
                } else {
                    // Heuristic: check org name for clues
                    result.network_type = Some(
                        self.classify_by_org(result.asn_org.as_deref())
                            .to_string(),
                    );
                }
            } else {
                result.network_type = Some("isp".to_string());
            }
        }

        // Datacenter inference from reverse DNS (best-effort)
        if result.datacenter.is_none() {
            if let Some(dc) = Self::infer_datacenter_from_rdns(ip) {
                result.datacenter = Some(dc);
            }
        }

        result
    }

    /// Enrich the user's own public IP (for the location bar).
    pub fn enrich_self_ip(&self, ip: &str) -> SelfIpInfo {
        let mut info = SelfIpInfo {
            isp: None,
            asn: None,
            network_type: None,
        };

        let addr: IpAddr = match ip.parse() {
            Ok(a) => a,
            Err(_) => return info,
        };

        if let Some(ref reader) = self.asn_reader {
            if let Ok(record) = reader.lookup::<AsnRecord>(addr) {
                info.asn = record.autonomous_system_number;
                info.isp = record.autonomous_system_organization.clone();
            }
        }

        // Classify the user's network
        if let Some(asn) = info.asn {
            if self.hosting_asns.contains(&asn) {
                info.network_type = Some("hosting".to_string());
            } else {
                info.network_type = Some(
                    self.classify_self_network(info.isp.as_deref())
                        .to_string(),
                );
            }
        } else {
            info.network_type = Some("residential".to_string());
        }

        info
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    fn cache_dir() -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or("Could not determine home directory")?;
        Ok(home.join(".blip"))
    }

    async fn download_or_cache(url: &str, cache_path: &Path) -> Result<String, String> {
        // If cached file exists and is less than 24 hours old, use it
        if let Ok(meta) = fs::metadata(cache_path) {
            if let Ok(modified) = meta.modified() {
                if let Ok(age) = modified.elapsed() {
                    if age.as_secs() < 86400 {
                        if let Ok(data) = fs::read_to_string(cache_path) {
                            log::info!("Using cached file: {}", cache_path.display());
                            return Ok(data);
                        }
                    }
                }
            }
        }

        log::info!("Downloading: {}", url);
        let resp = reqwest::get(url)
            .await
            .map_err(|e| format!("Failed to download {}: {}", url, e))?;

        if !resp.status().is_success() {
            return Err(format!(
                "HTTP {} downloading {}",
                resp.status(),
                url
            ));
        }

        let body = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read response body: {}", e))?;

        // Write to cache
        if let Err(e) = fs::write(cache_path, &body) {
            log::warn!("Failed to cache file {}: {}", cache_path.display(), e);
        }

        Ok(body)
    }

    /// Classify network type from ASN org name for destination IPs.
    fn classify_by_org(&self, org: Option<&str>) -> &'static str {
        let org = match org {
            Some(o) => o.to_lowercase(),
            None => return "isp",
        };

        let enterprise_keywords = [
            "university",
            "college",
            "bank",
            "government",
            "federal",
            "corp",
            "inc.",
            "ltd",
            "department",
            "ministry",
        ];
        for kw in &enterprise_keywords {
            if org.contains(kw) {
                return "enterprise";
            }
        }

        let hosting_keywords = [
            "hosting",
            "server",
            "data center",
            "datacenter",
            "cloud",
            "vps",
        ];
        for kw in &hosting_keywords {
            if org.contains(kw) {
                return "cloud";
            }
        }

        "isp"
    }

    /// Classify network type for the user's own IP.
    fn classify_self_network(&self, isp: Option<&str>) -> &'static str {
        let isp = match isp {
            Some(s) => s.to_lowercase(),
            None => return "residential",
        };

        let business_keywords = [
            "business",
            "enterprise",
            "corporate",
            "commercial",
        ];
        for kw in &business_keywords {
            if isp.contains(kw) {
                return "business";
            }
        }

        let hosting_keywords = [
            "hosting",
            "server",
            "data center",
            "datacenter",
            "cloud",
        ];
        for kw in &hosting_keywords {
            if isp.contains(kw) {
                return "hosting";
            }
        }

        "residential"
    }

    /// Try to infer a datacenter name from reverse DNS patterns.
    fn infer_datacenter_from_rdns(ip: &str) -> Option<String> {
        // Best-effort synchronous reverse DNS
        let addr: IpAddr = ip.parse().ok()?;
        let hostname = match dns_lookup::lookup_addr(&addr) {
            Ok(h) => h,
            Err(_) => return None,
        };

        let hostname_lower = hostname.to_lowercase();

        // AWS pattern: ec2-X-X-X-X.region.compute.amazonaws.com
        if hostname_lower.contains(".amazonaws.com") {
            // Extract region from hostname
            let parts: Vec<&str> = hostname_lower.split('.').collect();
            for (i, part) in parts.iter().enumerate() {
                if *part == "compute" && i > 0 {
                    let region = parts[i - 1];
                    return Some(format!("AWS {}", region));
                }
            }
            return Some("AWS".to_string());
        }

        // GCP pattern: X.X.X.X.bc.googleusercontent.com
        if hostname_lower.contains(".googleusercontent.com")
            || hostname_lower.contains(".google.com")
        {
            return Some("Google Cloud".to_string());
        }

        // Azure pattern: various *.cloudapp.azure.com
        if hostname_lower.contains(".azure.com")
            || hostname_lower.contains(".azurewebsites.net")
        {
            return Some("Azure".to_string());
        }

        // Cloudflare
        if hostname_lower.contains(".cloudflare") {
            return Some("Cloudflare".to_string());
        }

        // Hetzner
        if hostname_lower.contains(".hetzner.") || hostname_lower.contains(".your-server.de") {
            return Some("Hetzner".to_string());
        }

        // OVH
        if hostname_lower.contains(".ovh.") || hostname_lower.contains(".ovhcloud.") {
            return Some("OVH".to_string());
        }

        // DigitalOcean
        if hostname_lower.contains(".digitalocean.com") {
            return Some("DigitalOcean".to_string());
        }

        None
    }
}
