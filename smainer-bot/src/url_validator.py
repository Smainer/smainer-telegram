"""URL validation and allowlist enforcement for Smainer security.

Validates deep-link return URLs against approved smainer.io/* pattern only
and enforces allowlist that excludes bot domain to prevent self-referential attacks.
"""

import logging
import re
from urllib.parse import urlparse
from typing import Optional, Set

logger = logging.getLogger(__name__)

# Approved domains for deep-link return URLs
APPROVED_RETURN_DOMAINS: Set[str] = {
    "smainer.io",
    "app.smainer.io", 
    "smainer-miniapp.vercel.app"
}

# Blocked domains (bot domain to prevent self-referential attacks)
BLOCKED_DOMAINS: Set[str] = {
    "bot.smainer.io"
}

def validate_return_url(url: str) -> bool:
    """Validate deep-link return URL against approved smainer.io/* domains only.
    
    This prevents attackers from redirecting users to malicious domains after
    wallet connection flows.
    
    Args:
        url: The return URL to validate
        
    Returns:
        True if URL is allowed, False otherwise
    """
    if not url or not isinstance(url, str):
        return False
        
    try:
        parsed = urlparse(url.lower().strip())
        
        # Must use HTTPS (except localhost for development)
        if parsed.scheme != 'https' and not parsed.hostname in ('localhost', '127.0.0.1'):
            logger.warning(f"Return URL must use HTTPS: {url}")
            return False
            
        hostname = parsed.hostname
        if not hostname:
            logger.warning(f"Invalid hostname in return URL: {url}")
            return False
            
        # Check against blocked domains (prevents self-referential attacks)
        if hostname in BLOCKED_DOMAINS:
            logger.warning(f"Return URL blocked (bot domain): {hostname}")
            return False
            
        # Check against approved domains
        for approved_domain in APPROVED_RETURN_DOMAINS:
            if hostname == approved_domain or hostname.endswith(f'.{approved_domain}'):
                logger.info(f"Return URL validated: {hostname}")
                return True
                
        logger.warning(f"Return URL not in allowlist: {hostname}")
        return False
        
    except Exception as e:
        logger.error(f"Error validating return URL: {e}")
        return False


def validate_braavos_connect_url(base_host: str) -> Optional[str]:
    """Generate and validate Braavos wallet connect URL.
    
    Ensures the deep-link return URL uses only approved smainer.io domains.
    
    Args:
        base_host: The host to use in the connect URL (from window.location.host)
        
    Returns:
        Valid Braavos connect URL or None if validation fails
    """
    if not base_host:
        return None
        
    try:
        # Extract base domain, strip port numbers
        hostname = base_host.split(':')[0].lower().strip()
        
        # Validate the hostname is in approved domains
        hostname_allowed = False
        for approved_domain in APPROVED_RETURN_DOMAINS:
            if hostname == approved_domain or hostname.endswith(f'.{approved_domain}'):
                hostname_allowed = True
                break
                
        if not hostname_allowed:
            logger.warning(f"Braavos connect host not in allowlist: {hostname}")
            return None
            
        # Generate Braavos connect URL with validated return path
        return_url = f"https://{hostname}/connect?return=telegram"
        
        # Double-validate the return URL
        if not validate_return_url(return_url):
            logger.error(f"Generated return URL failed validation: {return_url}")
            return None
            
        braavos_url = f"https://link.braavos.app/dapp/{hostname}/connect?return=telegram"
        logger.info(f"Generated Braavos connect URL: {braavos_url}")
        return braavos_url
        
    except Exception as e:
        logger.error(f"Error generating Braavos connect URL: {e}")
        return None


def is_hijack_attempt(user_id: int, stored_user_id: int) -> bool:
    """Check for wallet state hijacking attempts.
    
    Prevents attackers from associating their wallet with another user's
    Telegram account by comparing authenticated user IDs.
    
    Args:
        user_id: User ID from verified Telegram initData
        stored_user_id: User ID from stored wallet state
        
    Returns:
        True if hijack attempt detected, False if legitimate
    """
    if user_id != stored_user_id:
        logger.warning(
            f"Wallet hijacking attempt: auth_user={user_id} stored_user={stored_user_id}"
        )
        return True
    return False