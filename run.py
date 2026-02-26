import asyncio
import logging
from hypercorn.config import Config
from hypercorn.asyncio import serve
from app import asgi_app, initialize_pinecone, build_bm25_index, setup_llm_chain
import os

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# Check HR_docs folder
hr_docs_path = "HR_docs/"
if not os.path.exists(hr_docs_path):
    logging.error(f"[ERROR] HR_docs folder not found at: {os.path.abspath(hr_docs_path)}")
    os.makedirs(hr_docs_path)
    logging.info("[OK] Created HR_docs folder")
else:
    pdf_files = [f for f in os.listdir(hr_docs_path) if f.endswith('.pdf')]
    logging.info(f"[INFO] Found {len(pdf_files)} PDF files in HR_docs folder:")
    for pdf in pdf_files:
        logging.info(f"   - {pdf}")

async def main():
    # Set up logging
    logging.basicConfig(level=logging.INFO,
                       format='%(asctime)s - %(levelname)s - %(message)s')
    
    try:
        # Initialize Pinecone
        logging.info("[INIT] Initializing Pinecone...")
        initialize_pinecone()
        
        # Build BM25 index
        logging.info("[INIT] Building BM25 index...")
        build_bm25_index(hr_docs_path)
        
        # Set up LLM and QA chain
        logging.info("[INIT] Setting up LLM and QA chain...")
        setup_llm_chain()
        
        # Start server
        logging.info("[START] Starting HR Assistant Suite...")
        config = Config()
        
        # Detect environment: Windows = local dev, Linux = production
        is_windows = os.name == 'nt'
        
        # Always use HTTP (HTTPS disabled for easier access)
        if is_windows:
            config.bind = ["127.0.0.1:5000"]  # Localhost for Windows (local dev)
            logging.info("[SERVER] HTTP server running on http://127.0.0.1:5000 (local development)")
        else:
            config.bind = ["0.0.0.0:5000"]  # All interfaces for Linux (production)
            logging.info("[SERVER] HTTP server running on http://0.0.0.0:5000 (production)")
        
        config.use_reloader = True
        await serve(asgi_app, config)
        
    except Exception as e:
        logging.error(f"[ERROR] Startup error: {str(e)}")
        raise

if __name__ == "__main__":
    asyncio.run(main()) 