#!/usr/bin/env python3

#
# mock-PrintOS.jar.py
#
# A dummy version of PrintOS.jar.
#
# Usage instructions in the README. To run for testing:
#     python3 -m pip install requests
#     python3 mock-PrintOS.jar.py
#
# We're open-sourcing this repo as an example Greengrass project, but we don't own PrintOS.jar, so
# we can't include it. The real PrintOS.jar formats the receipt print jobs and prints them. This
# implementation doesn't actually support printing, but it lets you run the project for testing
# purposes.
#

import configparser
import requests
import time

# Global config vars with defaults. Overwritten by read_config if it finds a PrintOSconfig.ini.
url = 'http://localhost:8083/lookup'
statusURL = 'http://localhost:8083/update'
sleep = '1'
username = 'ReceiptPrinterPi'
password = 'blueberry'

def read_config():
    config = configparser.ConfigParser()
    # configparser expects a section heading. Work around it by adding one.
    # https://stackoverflow.com/a/26859985
    with open('PrintOSconfig.ini') as stream:
        config.read_string("[section]\n" + stream.read())
    print('Config: {}'.format([x for x in config['section'].items()]))
    url = config['section']['url']
    statusURL = config['section']['statusURL']
    sleep = config['section']['sleep']
    username = config['section']['username']
    password = config['section']['password']

def handle_job(id, data):
    print('Reporting success for job {}. data: {}'.format(id, data))
    # Report back that we printed the job successfully.
    req_body = {
        'username': username,
        'password': password,
        'id': str(id),
        'status': 'Completed',
        'reset': '0',
        'printed': '1',
        'error_code': '0'
    }
    r = requests.post(statusURL, data = req_body)
    print('Response status: {}, body: {}'.format(r.status_code, r.text))

def poll_for_print_jobs():
    # Get the jobs from ReceiptPrinterHTTPInterface.
    req_body = {
        'username': username,
        'password': password,
        'version': '2'
    }
    r = requests.post(url, data = req_body)

    # Handle each job, if any.
    job_ids = r.json().get('ids') or []
    job_data = r.json().get('data') or []

    for (id, data) in zip(job_ids, job_data):
        handle_job(id, data)

def main():
    try:
        read_config()
    except Exception as e:
        print('Failed to read PrintOSconfig.ini. Using default config. Exception: {}'.format(e))

    # Poll forever.
    while True:
        time.sleep(int(sleep))

        try:
            poll_for_print_jobs()
        except Exception as e:
            print('Failed to poll for print jobs. Exception: {}'.format(e))

if __name__ == "__main__":
    main()