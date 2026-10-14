from botocore.exceptions import ClientError
from .config import settings
from .storage import client

if settings().storage == "s3":
    s3 = client()
    try:
        s3.head_bucket(Bucket=settings().s3_bucket)
    except ClientError as error:
        if str(error.response.get("Error", {}).get("Code")) not in (
            "404",
            "NoSuchBucket",
        ):
            raise
        s3.create_bucket(Bucket=settings().s3_bucket)
