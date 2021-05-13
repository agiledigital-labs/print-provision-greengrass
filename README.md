# PrintOS Something todo name

See <https://jira.agiledigital.com.au/browse/QFXFB-888>.

Based on <https://github.com/DataPOS-Labs/print-provision>. Runs in [AWS
Greengrass](https://docs.aws.amazon.com/greengrass/v2/developerguide/what-is-iot-greengrass.html).

 - todo explain what a greengrass component is and other basic info
 - todo put the drawio diagram in here
 - todo is there anything we should copy from the print-provision repo's README?
 - todo document how greengrass handles health checking
 - todo document how to manage the devices using greengrass
 - todo `nvm use` and `npm install` for the components that need that
 - todo document how to set up a pi from scratch, install greengrass, etc. see greengrass docs.
        - maybe link to them
        - need to explain/link the minimal installer policy?
        - how to install the aws cli? only v1 supported on Pi (32-bit)
        - how to put temp creds on the pi? e.g. 
          ```
          (aws sts assume-role --role-arn
          arn:aws:iam::926078734639:role/greengrass-core-installer --role-session-name
          "RoleSession1")
          ```
          the parens are just to run it in a subshell. it prints the creds
 - todo document this:
        - to deploy the custom component locally to test it, copy to the pi
          ```
          ./copy-to-pi.sh
          ```
          (takes a while first time because of node_modules) and then run these commands on the pi
          (not sure you actually need the first one)
          ```
          ./deploy-local-on-pi.sh
          ```
        - then you can check the logs in /greengrass/v2/logs, e.g.
            `sudo tail -f /greengrass/v2/logs/io.datapos.ReceiptPrinterMQTTInterface.log`
        - it takes a while

### Remote Printing Process

 1. A patron places an order through one of the patron apps.
 1. [core-services](https://stash.agiledigital.com.au/projects/QFX/repos/merivale/browse/server)
    creates a print job with
    [printos-serverless-service](https://github.com/DataPOS-Labs/printos-serverless-service) to
    print the order receipt on the vendor's printer.
 1. printos-serverless-service sends the print job to the vendor's Raspberry Pi over MQTT.
 1. The MQTT message triggers the ReceiptPrinterMQTTInterface Lambda, which runs on the Raspberry
    Pi. It just passes the print job along to ReceiptPrinterHTTPInterface.
 1. ReceiptPrinter polls ReceiptPrinterHTTPInterface and receives the print job. It formats the
    receipt and prints it. Then it tells ReceiptPrinterHTTPInterface that the job is complete, which
    tells printos-serverless-service and so on.

todo explain why it uses mqtt. something like this (below). also mention qos?

It has an MQTT interface because that's the protocol AWS IoT uses and also has an HTTP interface for
jobs submitted locally by PotatOS. and that the HTTP interface is also polled by PrintOS.jar. maybe
make a diagram of everything if there's time.  see
https://docs.aws.amazon.com/iot/latest/developerguide/protocols.html

### Local Network Printing Process

 1. A patron places an order in person and the vendor's staff enter it into PotatOS.
 1. PotatOS submits a print job for the receipt over the local network through the HTTP interface.
 1. ReceiptPrinter polls ReceiptPrinterHTTPInterface and receives the print job. It formats the
    receipt and prints it.

## Directory Structure

todo add ReceiptPrinterMQTTInterface-component.yaml and deployment.yaml
```
├── artifacts/
│   │ The software artifacts for the Greengrass components, one subdir per component. The contents
│   │ are deployed to the IoT devices (the Raspberry Pis).
│   ├── io.datapos.ReceiptPrinter/
│   │     Formats the print jobs and prints them.
│   ├── io.datapos.ReceiptPrinterHTTPInterface/
│   │     Receives print jobs through HTTP from the local network and from
│   │     ReceiptPrinterMQTTInterface.
│   └── io.datapos.ReceiptPrinterMQTTInterface/
│         Receives remote (internet) print jobs from AWS through MQTT.
├── copy-to-pi.sh
│     Copies this dir to your test device (RPi) so you can deploy locally for testing.
├── deploy-local-on-pi.sh
│     Deploy locally for testing. Run this on your test device.
└── recipes/
    │ The config and metadata for the Greengrass components.
    ├── io.datapos.ReceiptPrinterMQTTInterface-1.0.0.yaml
    ├── todo add http interface here if we actually end up creating that file
    └── io.datapos.ReceiptPrinter-1.0.0.yaml
```

## Testing

For testing, you can configure the ReceiptPrinter component to print to PDF. However, the PDF will
always be blank, so you still need a real receipt printer to test the output.

 1. Install the print-to-PDF driver on your test device: `sudo apt install cups cups-bsd
    printer-driver-cups-pdf`
 1. In `/etc/cups/cups-pdf.conf` on your device, comment out the line `Out ${HOME}/PDF`. That
    configures the driver to write the PDFs to `/var/spool/cups-pdf/ggc_user` (`ggc_user` is the
    user the component runs as), which avoids permissions issues.
 1. Restart CUPS: `sudo systemctl restart cups`
 1. In [io.datapos.ReceiptPrinter-1.0.0.yaml](recipes/io.datapos.ReceiptPrinter-1.0.0.yaml), change
    `printer: EPSON_TM-T82III` to `printer: PDF` and redeploy.

### Submitting a Test Job

In this example, `https://3qpbp0efwe.execute-api.ap-southeast-2.amazonaws.com/dev/submit` is the
`/submit` endpoint of your
[printos-serverless-service](https://github.com/DataPOS-Labs/printos-serverless-service) deployment,
`blueberry` is the password in its DynamoDB and `MyGreengrassCore` is the AWS IoT Thing Name of your
test device (i.e. your Raspberry Pi).

```
curl https://3qpbp0efwe.execute-api.ap-southeast-2.amazonaws.com/dev/submit --data 'destination=MyG\
reengrassCore&password=blueberry&data=%7B%22mode%22%3A%22tagged%22%2C%22comments%22%3A%22%3Ccenter%\
3E+Powered+by+DataPOS+%3C%2Fcenter%3E+%3Ccenter%3E+Powered+by+DataPOS+%3C%2Fcenter%3E+%3Ccenter%3E+\
%3Ch3%3ETime+Ordered%3A%3C%2Fh3%3E+%3C%2Fcenter%3E+%3Ccenter%3E+%3Ch3%3E+2%2F05%2F21+2%3A23+PM+%3C%\
2Fh3%3E+%3C%2Fcenter%3E+%3Cleft%3EService+Mode%3A+TakeAway%3C%2Fleft%3E+++++%3Cleft%3E+%3Ch3%3E1+Br\
azilian+Rooster%7E%3C%2Fh3%3E+%3C%2Fleft%3E+++++%3Cleft%3E+%3Ch3%3E2+Japanese+Rooster%7E%3C%2Fh3%3E\
+%3C%2Fleft%3E+++++%3Cleft%3E+%3Ch3%3E1+Little+Rooster%7E%3C%2Fh3%3E+%3C%2Fleft%3E+++++%3Cleft%3E+%\
3Ch3%3E1+Manly+Rooster%7E%3C%2Fh3%3E+%3C%2Fleft%3E++++++%3Ccenter%3E%3Ch3%3E%2B+Pineapple%3C%2Fh3%3\
E%3C%2Fcenter%3E++++++%3Ccenter%3E%3Ch3%3E%2B+Bacon%3C%2Fh3%3E%3C%2Fcenter%3E+++++++++%3Cleft%3E+%3\
Ch3%3E3+Hot+Chips%3C%2Fh3%3E+%3C%2Fleft%3E++++++%3Ccenter%3E%3Ch3%3EChicken+Salt%3C%2Fh3%3E%3C%2Fce\
nter%3E+++++%3Cleft%3E+%3Ch3%3E2+Hot+Chips%3C%2Fh3%3E+%3C%2Fleft%3E++++++%3Ccenter%3E%3Ch3%3ERegula\
r+Salt%3C%2Fh3%3E%3C%2Fcenter%3E++++%3Ccenter%3E+%3Ch4%3EOrder+and+Collect%3C%2Fh4%3E+%3C%2Fcenter%\
3E+%3Ccenter%3E+%3Ch5%3EOrder+NO.+Y14%3C%2Fh5%3E+%3C%2Fcenter%3E++++%3Cleft%3EPhone%3A+%2B614001210\
94%3C%2Fleft%3E+++++%3Cleft%3EName%3A+Sharon+Newman%3C%2Fleft%3E++++%3Ccenter%3E+Powered+by+DataPOS\
+%3C%2Fcenter%3E+%22%7D'
```

## Deploying

### For Development

todo

If you've deployed a component through AWS (i.e. not locally), you'll need to remove it before
deploying a different version of it locally.

AWS doesn't seem to support deploying Lambda components locally, so you have to use the production
instructions for ReceiptPrinterMQTTInterface unfortunately.

### For Production

todo finish this
todo write a script for this

1. Create the ReceiptPrinterMQTTInterface Lambda function in AWS.
1. Edit `ReceiptPrinterMQTTInterface-component.yaml` and set `lambdaArn` to the ARN of the function
   you created.
1. Create/update the component in Greengrass. Take note of the `componentVersion` it prints out.
   ```
   aws greengrassv2 create-component-version \
       --cli-input-yaml file://ReceiptPrinterMQTTInterface-component.yaml
   ```
1. Check its `componentState` until it's `DEPLOYABLE`.
   ```
   aws greengrassv2 describe-component --arn [Your function's ARN]
   ```
1. Edit `deployment.yaml`:
   1. Set `targetArn` to the ARN of your Thing Group.
   1. Set the `componentVersion` for `io.datapos.ReceiptPrinterMQTTInterface` to the new version you
      created.
1. Create/update the deployment in Greengrass.
   ```
   aws greengrassv2 create-deployment --cli-input-yaml file://deployment.yaml
   ```

You can check the progress of the deployment in the AWS Console. To check the progress on a
particular device, run `aws greengrassv2 list-installed-components --core-device-thing-name [thing
name]` to see the version numbers of the components currently deployed to it. Or run `sudo
/greengrass/v2/bin/greengrass-cli component list` on the device itself.
