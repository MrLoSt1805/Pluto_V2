import os
import sqlite3

from app import DATABASE_NAME, app


def repair_resume_paths():
    """Repair existing evaluations.resume_path values to store only filenames.

    Rules:
    - If resume_path is a full/relative path, replace it with basename().
    - If resume_path is NULL/empty but filename exists and uploads/filename exists,
      set resume_path = filename.
    """
    db_path = DATABASE_NAME
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("SELECT id, resume_path, filename FROM evaluations")
    rows = cursor.fetchall()

    upload_folder = app.config['UPLOAD_FOLDER']
    repaired = 0
    skipped = 0

    for eval_id, resume_path, filename in rows:
        original_resume_path = resume_path
        resume_filename = None

        if resume_path:
            # If it looks like a path, strip down to basename
            resume_filename = os.path.basename(str(resume_path).strip().strip('"').strip("'"))
        elif filename:
            # No resume_path stored, fall back to filename if file exists
            candidate = os.path.basename(str(filename).strip().strip('"').strip("'"))
            full_candidate = os.path.normpath(os.path.join(upload_folder, candidate))
            if os.path.exists(full_candidate):
                resume_filename = candidate

        if resume_filename and resume_filename != original_resume_path:
            cursor.execute(
                "UPDATE evaluations SET resume_path = ? WHERE id = ?",
                (resume_filename, eval_id),
            )
            repaired += 1
        else:
            skipped += 1

    conn.commit()
    conn.close()

    print(f"Repair complete. Repaired rows: {repaired}, unchanged/skipped: {skipped}")


if __name__ == "__main__":
    repair_resume_paths()






